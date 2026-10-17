// ============================================================
// LOT 3 — POSER LA PROVENANCE PAR CHAMP DES DONNÉES BULBAPEDIA ET LA MARQUE « À RECONFIRMER » (écriture ADDITIVE ; à blanc par défaut ; écriture sur PLAN SIGNÉ)
// ============================================================
//   1. node poser-provenance-bulba.js --sortie=<plan.json>          ESSAI À BLANC (lecture seule) : comptes, coût, plan écrit, son sha256 et la commande d'écriture exacte
//   2. node lot-additif.js --quoi="provenance par champ des donnees Bulbapedia 2026-10" --collections=cartes,sets -- node poser-provenance-bulba.js --ecrire --attendu=<n> --plan=<plan.json> --empreinte=<sha256>
//                                                                   (le coordinateur, depuis main)
// L'écriture RECALCULE le plan et REFUSE s'il diffère de celui de l'essai à blanc (nombre de champs, contenu des écritures, fichiers d'entrée) ; `--sources=` / `--variants=` ne sont
// acceptés que s'ils sont ceux du plan ; `--attendu` reste obligatoire ; `modifiedCount` est comparé aux documents envoyés.
// Pose, sur `cartes` et `sets`, `provenance.<champ> = { confirmePar, accord, empreinteValeur }` (ou `aReconfirmer: true` + `motif`), `provenance.source` et `provenance.le` au document.
// AUCUNE valeur existante n'est modifiée : tout ce qui s'écrit est sous `provenance.`. Une provenance de forme étrangère est sautée, comptée, listée. `provenance` est INTERNE ;
// un champ `aReconfirmer` ne doit jamais être la seule preuve d'une identification.
require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const { ouvrirSimulation } = require('./collecte-cartes/ouvrir-lecture');
const { preparer, entreesDuPlan } = require('./collecte-cartes/pipeline-bulba');
const { planifierProvenance, appliquer, analyserArguments, verifierPlan, verifierRelecture, empreintePlan, verifierPlanFichier } = require('./collecte-cartes/provenance-bulba');

const sha256Octets = b => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
    const A = analyserArguments(process.argv.slice(2));
    if (A.erreurs.length) { for (const e of A.erreurs) console.error(`❌ ${e}`); process.exit(2); }
    const ECRIRE = A.ecrire;
    // en écriture : le plan fixe les options ; une option de la ligne de commande n'est acceptée que si elle est celle du plan (verifierPlanFichier)
    let planFichier = null, shaFichier = null;
    if (ECRIRE) { const octets = fs.readFileSync(A.plan); shaFichier = sha256Octets(octets); planFichier = JSON.parse(octets.toString('utf8')); }
    const opts = ECRIRE ? { sources: planFichier.options?.sources ?? null, variants: planFichier.options?.variants ?? null } : { sources: A.sources, variants: A.variants };
    const cx = ECRIRE ? await require('./collecte-cartes/garde').ouvrirConnexions({ production: false, buckets: [] })
        : await ouvrirSimulation({ viaEcriture: A.viaEcriture, ouvrirConnexions: require('./collecte-cartes/garde').ouvrirConnexions });
    const db = cx.cartes.db;
    const lire = async () => {
        const P = await preparer(db, { dossierSources: opts.sources, fichierVariants: opts.variants });
        const plan = planifierProvenance({ cartes: P.cartes, sets: P.sets, lignes: P.cible.lignes, appariements: P.cible.appariements, arbitrages: P.arbitrage.entrees, maintenant: new Date() });
        return { P, plan };
    };
    const { P, plan } = await lire();
    const C = plan.compte;
    const entrees = entreesDuPlan({ dossierSources: opts.sources, fichierVariants: opts.variants });
    const empreinteEcritures = empreintePlan(plan.ecritures);

    console.log(`DÉNOMINATEURS : ${P.cartes.length} cartes d'origine Bulbapedia · ${P.sets.length} sets · lignes de confrontation ${P.cible.lignes.length} · appariements ${P.cible.appariements.length} · arbitrages ${P.arbitrage.entrees.length}`);
    console.log('PAR CHAMP (état final après cette passe) : plein / partiel / arbitrage · à reconfirmer : désaccord / non couvert · écrits maintenant');
    const tot = { plein: 0, partiel: 0, arbitrage: 0, des: 0, nc: 0 };
    for (const [ch, p] of Object.entries(C.parChamp).sort()) {
        console.log(`   ${ch.padEnd(24)} ${String(p.plein).padStart(6)} / ${String(p.partiel).padStart(5)} / ${String(p.arbitrage).padStart(5)}  ·  ${String(p.aReconfirmerDesaccord).padStart(5)} / ${String(p.aReconfirmerNonCouvert).padStart(6)}  ·  ${String(p.ecrits).padStart(6)}`);
        tot.plein += p.plein; tot.partiel += p.partiel; tot.arbitrage += p.arbitrage; tot.des += p.aReconfirmerDesaccord; tot.nc += p.aReconfirmerNonCouvert;
    }
    const conf = tot.plein + tot.partiel + tot.arbitrage, reco = tot.des + tot.nc;
    console.log(`TOTAL : ${conf} confirmés (plein ${tot.plein}, partiel ${tot.partiel}, arbitrage ${tot.arbitrage}) · ${reco} à reconfirmer (désaccord ${tot.des}, non couvert ${tot.nc}) · taux de DOUTE réel (désaccord) ${(100 * tot.des / (conf + reco)).toFixed(2)} %`);
    console.log(`SETS SANS ORIGINE PROUVÉE (aucune provenance posée) : ${JSON.stringify(C.setsSansOrigine)}`);
    console.log(`PROVENANCE DE FORME ÉTRANGÈRE (sautée, jamais écrasée) : ${C.formeEtrangere.documents} documents, ${C.formeEtrangere.champs} champs${C.formeEtrangere.liste.length ? ' · ' + JSON.stringify(C.formeEtrangere.liste.slice(0, 5)) : ''}`);
    console.log(`DOCUMENTS À ÉCRIRE : ${C.cartes} cartes · ${C.sets} sets · CHAMPS À ÉCRIRE : ${C.champsAEcrire} · impressions à clé en double (suffixe #n) : ${C.clesEnDouble}`);
    // le COÛT, mesuré en octets BSON des `$set` (pas estimé)
    const { BSON } = require('mongodb');
    const octets = plan.ecritures.reduce((n, e) => n + BSON.calculateObjectSize(e.champs), 0);
    console.log(`COÛT : ${(octets / 1e6).toFixed(1)} Mo de BSON écrits (${plan.ecritures.length ? Math.round(octets / plan.ecritures.length) : 0} octets par document, ${C.champsAEcrire ? (octets / C.champsAEcrire).toFixed(1) : 0} par champ)`);
    // AUCUNE valeur existante n'est modifiée : tout chemin écrit est sous provenance.
    const hors = plan.ecritures.flatMap(e => Object.keys(e.champs)).filter(k => !k.startsWith('provenance.'));
    if (hors.length) throw new Error(`chemins hors provenance : ${hors.slice(0, 3).join(', ')} — refus`);
    // IDEMPOTENCE À BLANC : le plan appliqué en mémoire aux documents lus, puis rejoué sur le résultat, doit tomber à zéro (et ne toucher à aucune valeur)
    {
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
    if (!ECRIRE) {
        let suite = '';
        if (A.sortie) {
            const contenu = JSON.stringify({ version: 1, genereLe: new Date().toISOString(), options: { sources: A.sources, variants: A.variants }, attendu: C.champsAEcrire, documents: plan.ecritures.length,
                empreinteEcritures, entrees, coutOctets: octets, compte: { ...C, formeEtrangere: { ...C.formeEtrangere, liste: C.formeEtrangere.liste.slice(0, 200) } } }, null, 1);
            fs.writeFileSync(A.sortie, contenu);
            const sha = sha256Octets(Buffer.from(contenu, 'utf8'));
            suite = `\nPLAN ÉCRIT : ${A.sortie}\nEMPREINTE DU PLAN (sha256 du fichier) : ${sha}\nCOMMANDE D'ÉCRITURE (coordinateur, depuis main) :\n   node lot-additif.js --quoi="provenance par champ des donnees Bulbapedia 2026-10" --collections=cartes,sets -- node poser-provenance-bulba.js --ecrire --attendu=${C.champsAEcrire} --plan=${A.sortie} --empreinte=${sha}`;
        } else suite = '\n(aucun plan écrit : relancer avec --sortie=<plan.json> ; l\'écriture exige ce plan et son empreinte)';
        console.log(`\n(essai à blanc — rien n'est écrit en base)${suite}`);
        await cx.fermer(); return;
    }
    // ── L'ÉCRITURE : sur plan signé seulement
    const refusPlan = verifierPlanFichier({ plan: planFichier, shaFichier, empreinteDonnee: A.empreinte, recalcul: { attendu: C.champsAEcrire, empreinteEcritures, entrees }, options: { sources: A.sources, variants: A.variants } });
    const refus = refusPlan.length ? refusPlan.join(' · ') : verifierPlan(C.champsAEcrire, A.attendu);
    if (refus) { console.error(`❌ ${refus}`); await cx.fermer(); process.exit(2); }
    let docs = 0, mod = 0;
    for (const col of ['cartes', 'sets']) {
        const ops = plan.ecritures.filter(e => e.collection === col).map(e => ({ updateOne: { filter: { _id: e._id }, update: { $set: e.champs } } }));
        for (let i = 0; i < ops.length; i += 500) { const lot = ops.slice(i, i + 500); const r = await db.collection(col).bulkWrite(lot, { ordered: false }); docs += lot.length; mod += r.modifiedCount; }
    }
    const ecrits = plan.compte.champsAEcrire;
    const relu = (await lire()).plan;   // relu en base, pas déduit de ce qu'on a envoyé : le même plan rejoué doit tomber à zéro
    console.log(`ÉCRIT : ${mod} documents modifiés (modifiedCount) sur ${docs} envoyés · ${ecrits} champs · RELU : ${relu.compte.champsAEcrire} champs restent à écrire`);
    await cx.fermer();
    const discord = verifierRelecture({ ecrits, attendu: A.attendu, restants: relu.compte.champsAEcrire, modifies: mod, documents: docs });
    console.log(discord ? `🔴 NE CONCORDE PAS : ${discord}` : `✅ concordant : ${ecrits} écrits = ${A.attendu} attendus, ${mod} documents modifiés = ${docs} envoyés, 0 reste`);
    if (discord) process.exitCode = 1;
})().catch(e => { console.error('❌', e.message); process.exit(1); });
