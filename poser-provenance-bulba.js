// ============================================================
// LOT 3 — POSER LA PROVENANCE PAR CHAMP DES DONNÉES BULBAPEDIA ET LA MARQUE « À RECONFIRMER » (écriture ADDITIVE ; à blanc par défaut)
// ============================================================
//   node poser-provenance-bulba.js [--sortie=<simulation.json>]            SIMULATION (lecture seule) : comptes par champ (confirmés / à reconfirmer), documents, champs à écrire
//   node lot-additif.js --quoi="provenance par champ des donnees Bulbapedia 2026-10" --collections=cartes,sets -- node poser-provenance-bulba.js --ecrire --attendu=<n>
//                                                                           (le coordinateur, depuis main ; <n> = « CHAMPS À ÉCRIRE » de la simulation)
// Pose, sur `cartes` (et `sets` pour les champs de set), `provenance.<champ> = { source: 'bulbapedia', confirmePar: […], le }` quand au moins une source indépendante concorde
// (ou qu'un arbitrage « juste » le confirme), et `aReconfirmer: true` quand AUCUNE ne confirme. AUCUNE valeur existante n'est modifiée : tout ce qui s'écrit est sous `provenance.`.
// Idempotent (rejouer n'écrit rien), monotone (jamais de dégradation), `--attendu=<n>` obligatoire avec `--ecrire`. `provenance` est INTERNE : le site ne le lit pas, la garde de
// lot ne le compte pas (aucun set revalidé) ; un champ `aReconfirmer` ne doit jamais être la seule preuve d'une identification.
require('dotenv').config();
const fs = require('fs');
const { ouvrirSimulation } = require('./collecte-cartes/ouvrir-lecture');
const { preparer } = require('./collecte-cartes/pipeline-bulba');
const { planifierProvenance, analyserArguments, verifierPlan, verifierRelecture } = require('./collecte-cartes/provenance-bulba');

(async () => {
    const A = analyserArguments(process.argv.slice(2));
    if (A.erreurs.length) { for (const e of A.erreurs) console.error(`❌ ${e}`); process.exit(2); }
    const val = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || null;
    const ECRIRE = A.ecrire;
    const cx = ECRIRE ? await require('./collecte-cartes/garde').ouvrirConnexions({ production: false, buckets: [] })
        : await ouvrirSimulation({ viaEcriture: A.viaEcriture, ouvrirConnexions: require('./collecte-cartes/garde').ouvrirConnexions });
    const db = cx.cartes.db;
    const lire = async () => {
        const P = await preparer(db, { dossierSources: val('sources'), fichierVariants: val('variants') });
        const plan = planifierProvenance({ cartes: P.cartes, sets: P.sets, lignes: P.cible.lignes, appariements: P.cible.appariements, arbitrages: P.arbitrage.entrees, maintenant: new Date() });
        return { P, plan };
    };
    const { P, plan } = await lire();
    const C = plan.compte;
    console.log(`DÉNOMINATEURS : ${P.cartes.length} cartes d'origine Bulbapedia · ${P.sets.length} sets · lignes de confrontation ${P.cible.lignes.length} · appariements ${P.cible.appariements.length} · arbitrages ${P.arbitrage.entrees.length}`);
    console.log('PAR CHAMP (état final après cette passe : confirmés / à reconfirmer · dont écrits maintenant) :');
    for (const [ch, p] of Object.entries(C.parChamp).sort()) console.log(`   ${ch.padEnd(24)} ${String(p.confirmes).padStart(6)} confirmés · ${String(p.aReconfirmer).padStart(6)} à reconfirmer · ${String(p.ecrits).padStart(6)} écrits`);
    const tot = Object.values(C.parChamp).reduce((o, p) => ({ c: o.c + p.confirmes, r: o.r + p.aReconfirmer }), { c: 0, r: 0 });
    console.log(`TOTAL : ${tot.c} confirmés · ${tot.r} à reconfirmer (${(100 * tot.r / (tot.c + tot.r)).toFixed(1)} %)`);
    console.log(`DOCUMENTS À ÉCRIRE : ${C.cartes} cartes · ${C.sets} sets · CHAMPS À ÉCRIRE : ${C.champsAEcrire} · impressions à clé en double (suffixe #n) : ${C.clesEnDouble}`);
    // AUCUNE valeur existante n'est modifiée : tout chemin écrit est sous provenance.
    const hors = plan.ecritures.flatMap(e => Object.keys(e.champs)).filter(k => !k.startsWith('provenance.'));
    if (hors.length) throw new Error(`chemins hors provenance : ${hors.slice(0, 3).join(', ')} — refus`);
    // IDEMPOTENCE À BLANC : le plan appliqué en mémoire aux documents lus, puis rejoué sur le résultat, doit tomber à zéro (et ne toucher à aucune valeur)
    {
        const { appliquer } = require('./collecte-cartes/provenance-bulba');
        const parId = { cartes: new Map(P.cartes.map(c => [c._id, c])), sets: new Map(P.sets.map(s => [s._id, s])) };
        let valeursTouchees = 0;
        for (const e of plan.ecritures) {
            const doc = parId[e.collection].get(e._id); const avant = JSON.stringify({ ...doc, provenance: undefined });
            appliquer(doc, structuredClone(e.champs));
            if (JSON.stringify({ ...doc, provenance: undefined }) !== avant) valeursTouchees++;
        }
        const rejeu = planifierProvenance({ cartes: P.cartes, sets: P.sets, lignes: P.cible.lignes, appariements: P.cible.appariements, arbitrages: P.arbitrage.entrees, maintenant: new Date(Date.now() + 1000) });
        console.log(`IDEMPOTENCE À BLANC : plan appliqué en mémoire puis rejoué → ${rejeu.compte.champsAEcrire} champs à écrire (attendu 0) ${rejeu.compte.champsAEcrire === 0 ? '✅' : '🔴'} · documents dont une valeur hors provenance a changé : ${valeursTouchees} (attendu 0) ${valeursTouchees === 0 ? '✅' : '🔴'}`);
        if (rejeu.compte.champsAEcrire !== 0 || valeursTouchees !== 0) throw new Error('le plan n\'est pas idempotent ou touche une valeur : refus');
    }
    if (val('sortie')) fs.writeFileSync(val('sortie'), JSON.stringify({ genereLe: new Date().toISOString(), compte: C, total: tot, exemples: plan.ecritures.slice(0, 3) }, null, 1));
    if (!ECRIRE) {
        console.log(`\n(simulation seule — rien n'est écrit)\nCOMMANDE (coordinateur, depuis main) :\n   node lot-additif.js --quoi="provenance par champ des donnees Bulbapedia 2026-10" --collections=cartes,sets -- node poser-provenance-bulba.js --ecrire --attendu=${C.champsAEcrire}`);
        await cx.fermer(); return;
    }
    const refus = verifierPlan(C.champsAEcrire, A.attendu);
    if (refus) { console.error(`❌ ${refus}`); await cx.fermer(); process.exit(2); }
    // l'écriture : un `$set` de chemins `provenance.*` par document, jamais autre chose
    let docs = 0, mod = 0;
    for (const col of ['cartes', 'sets']) {
        const ops = plan.ecritures.filter(e => e.collection === col).map(e => ({ updateOne: { filter: { _id: e._id }, update: { $set: e.champs } } }));
        for (let i = 0; i < ops.length; i += 500) { const r = await db.collection(col).bulkWrite(ops.slice(i, i + 500), { ordered: false }); docs += ops.slice(i, i + 500).length; mod += r.modifiedCount; }
    }
    const ecrits = plan.compte.champsAEcrire;
    const relu = (await lire()).plan;   // relu en base, pas déduit de ce qu'on a envoyé : le même plan rejoué doit tomber à zéro
    console.log(`ÉCRIT : ${mod} documents modifiés sur ${docs} envoyés · ${ecrits} champs · RELU : ${relu.compte.champsAEcrire} champs restent à écrire`);
    await cx.fermer();
    const discord = verifierRelecture({ ecrits, attendu: A.attendu, restants: relu.compte.champsAEcrire });
    console.log(discord ? `🔴 NE CONCORDE PAS : ${discord}` : `✅ concordant : ${ecrits} écrits = ${A.attendu} attendus, 0 reste`);
    if (discord) process.exitCode = 1;
})().catch(e => { console.error('❌', e.message); process.exit(1); });
