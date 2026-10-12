// ============================================================
// MESURE PASSIVE DE PIKAQIAN — ce que les pages apprises donneraient à NOS trous (2026-10-12) — LECTURE SEULE, ZÉRO REQUÊTE
// ============================================================
//   node plan-pikaqian-appris.js [--dossier=<chemin>]
//
// Pour chaque page apprise par le récepteur (recepteur-pikaqian.js), la plus récente par code de set : les TROUS de nos fiches dans ce set —
// `planifier` de collecteur-images-pikaqian.js, la fonction même que le collecteur utilise, jamais une copie — passés à `planifierPikaqian`
// (production). Par set : tuiles, produits, trous, appariés, restes par motif, et combien d'appariés ont une adresse OFFICIELLE (cdn.pokemon-tcg.cn)
// déclarée par la page. Dénominateurs imprimés.
// Aucune requête réseau vers un site. La base `cartes` est lue par l'utilisateur de LECTURE (MONGODB_CARTES_LECTURE_URI, jugé par jugerLecture, ses
// privilèges constatés par verifierPrivilegesLecture, et chaque appel passé par facadeLecture : find/count/distinct seulement) — jamais l'URI d'écriture.
// ⚠️ « Apparié » ne veut pas dire « téléchargeable » : le téléchargement depuis le CDN officiel n'est PAS décidé (PIKAQIAN-PASSIF.md, « ce qui manque »).
const fs = require('fs');
const path = require('path');
const P = require('./collecte-cartes/pikaqian');
const { TABLE_PIKAQIAN } = require('./collecte-cartes/pikaqian-sets');
const { DOSSIER_DEFAUT, attenduParTable } = require('./recepteur-pikaqian');
const { largeurMinDe } = require('./collecte-cartes/seuils-images');

const CODE = P.CODE_PK;     // le motif de code de set de la production, jamais recopié
const NOM_FICHIER = new RegExp(`^(${CODE.source.slice(1, -1)})--(\\d{8}T\\d{6}Z)(?:-\\d+)?\\.json$`);
const somme = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] || 0) + v; return a; };

/** Les fiches du dossier : { fiches (la plus récente par code), anciens, illisibles, fichiers }. Un fichier qui ne tient pas à la relecture n'est pas mesuré, et sa raison s'écrit. */
function lireApprises(dossier, attendu = attenduParTable) {
    const noms = fs.readdirSync(dossier).filter(n => n.endsWith('.json'));
    const illisibles = [], parCode = new Map();
    for (const nom of noms) {
        const m = NOM_FICHIER.exec(nom);
        let fiche;
        try { fiche = JSON.parse(fs.readFileSync(path.join(dossier, nom), 'utf8')); } catch (e) { illisibles.push({ fichier: nom, motif: `JSON illisible (${e.message.slice(0, 60)})` }); continue; }
        if (!m) { illisibles.push({ fichier: nom, motif: 'nom hors du format <code>--<horodatage>.json' }); continue; }
        if (fiche?.schema !== 1 || fiche.code !== m[1] || !CODE.test(String(fiche.code)) || !Array.isArray(fiche.tuiles) || !Array.isArray(fiche.origines)) { illisibles.push({ fichier: nom, motif: 'fiche hors du format écrit par le récepteur (schéma 1)' }); continue; }
        // le verdict ne se croit pas sur parole : la relecture par la fonction de production, sur les tuiles du fichier
        const V = P.verdictDePage({ tuiles: fiche.tuiles, code: fiche.code });
        if (!V.ok) { illisibles.push({ fichier: nom, motif: V.motif }); continue; }
        // défense en profondeur : le récepteur refuse déjà ces pages ; un fichier qui en viendrait d'ailleurs (ancien, édité) ne fait pas compter de « absente-de-la-source »
        if (Number.isInteger(fiche.ancres) && fiche.ancres > fiche.tuiles.length) { illisibles.push({ fichier: nom, motif: `page partielle ou forme changée : ${fiche.ancres} ancres, ${fiche.tuiles.length} tuiles` }); continue; }
        const voulu = attendu(fiche.code);
        if (voulu && fiche.tuiles.length < voulu) { illisibles.push({ fichier: nom, motif: `page incomplète : ${fiche.tuiles.length} tuiles lues, ${voulu} relevées pour ce set à la mesure` }); continue; }
        const courante = parCode.get(fiche.code);
        // la plus récente par code (l'horodatage du nom, puis le nom) ; les autres sont comptées, jamais mesurées
        if (!courante || m[2] > courante.horodatage || (m[2] === courante.horodatage && nom > courante.fichier)) parCode.set(fiche.code, { fichier: nom, horodatage: m[2], fiche, verdict: V, compteAnciens: courante ? courante.compteAnciens + 1 : 0 });
        else courante.compteAnciens++;
    }
    const lues = [...parCode.values()];
    return { fiches: lues, anciens: lues.reduce((s, x) => s + x.compteAnciens, 0), illisibles, fichiers: noms.length };
}

/**
 * @param {{dossier: string, db: object, planifier?: Function, table?: object[]}} o
 * `db` : lecture seule (find, findOne, countDocuments). `C` : le collecteur (planifier, releve, gardeTirage, gardeProduits, uniteDeLaLigne — SES fonctions, rejouées avant
 * de planifier, comme `collecterSet` les applique avant toute requête) ; injectable seulement pour les bancs. Ce qui ne se rejoue pas sans fichier ou sans écriture :
 * le seuil de taille (jugé au téléchargement sur la largeur du fichier), la taille de la base (dbStats) et l'alerte de blocage — dits dans la sortie.
 */
async function mesurer({ dossier, db, C = require('./collecteur-images-pikaqian'), table = TABLE_PIKAQIAN, attendu = attenduParTable }) {
    const { uniteDeLaLigne } = require('./collecte-cartes/pikaqian-sets');
    const L = lireApprises(dossier, attendu);
    const sets = [];
    for (const { fichier, fiche, verdict } of L.fiches.sort((a, b) => a.fiche.code.localeCompare(b.fiche.code))) {
        const lignes = table.filter(l => l.codePk === fiche.code);
        if (!lignes.length) { sets.push({ code: fiche.code, fichier, slug: null, motif: 'code sans ligne dans collecte-cartes/pikaqian-sets.js', tuiles: fiche.tuiles.length, auCode: verdict.bonnes }); continue; }
        const officielles = new Map(fiche.origines.map(([id, o]) => [id, o?.officielle ?? null]));
        const declarees = [...officielles.values()].filter(Boolean).length;
        for (const ligne of lignes) {
            // LES GARDES DU COLLECTEUR, rejouées par ses fonctions : la ligne de table (releve), le tirage du set en base, les produits joints
            const base = { code: fiche.code, fichier, slug: ligne.slug, tuiles: fiche.tuiles.length, auCode: verdict.bonnes };
            const G = C.releve(uniteDeLaLigne(ligne));
            const set = await db.collection('sets').findOne({ _id: ligne.slug }, { projection: { tirage: 1, region: 1 } });
            const produitsJoints = await db.collection('cartes_produits').countDocuments({ slugSet: ligne.slug });
            const refus = !G.ok ? G : [C.gardeTirage(set, ligne, ligne.slug), C.gardeProduits(produitsJoints, ligne.slug)].find(g => !g.ok);
            if (refus) { sets.push({ ...base, produits: produitsJoints, refuse: { etat: refus.etat, motif: refus.motif } }); continue; }
            const Pl = await C.planifier(db, ligne.slug, ligne, fiche.tuiles);
            const restes = {};
            for (const r of Pl.restes) restes[r.motif] = (restes[r.motif] || 0) + 1;
            sets.push({
                ...base, produits: Pl.produits, trous: Pl.trous, apparies: Pl.plan.length,
                restes, appariesAvecOfficielle: Pl.plan.filter(p => officielles.get(p.tuile.id)).length, officiellesDeclarees: declarees, suffixesInconnus: Pl.suffixesInconnus.length
            });
        }
    }
    const mesures = sets.filter(s => s.slug && !s.refuse);
    const totaux = { sets: mesures.length, refuses: sets.filter(s => s.refuse).length, produits: 0, trous: 0, apparies: 0, appariesAvecOfficielle: 0, restes: {} };
    for (const s of mesures) { totaux.produits += s.produits; totaux.trous += s.trous; totaux.apparies += s.apparies; totaux.appariesAvecOfficielle += s.appariesAvecOfficielle; somme(totaux.restes, s.restes); }
    return { dossier, fichiers: L.fichiers, anciens: L.anciens, illisibles: L.illisibles, sets, totaux };
}

function formater(M) {
    const l = [];
    l.push(`Pages apprises : ${M.fichiers} fichier(s) .json dans ${M.dossier} · ${M.sets.length} set(s) (la plus récente par code) · ${M.anciens} version(s) plus ancienne(s) écartée(s) · ${M.illisibles.length} fichier(s) non mesuré(s)`);
    for (const x of M.illisibles) l.push(`   non mesuré : ${x.fichier} — ${x.motif}`);
    if (!M.sets.length) l.push('(aucune page apprise : ouvre une page de set, clique « Apprendre cette page », puis relance cette mesure)');
    for (const s of M.sets) {
        if (!s.slug) { l.push(`${s.code.padEnd(12)} NON MESURÉ : ${s.motif} (tuiles ${s.tuiles})`); continue; }
        if (s.refuse) { l.push(`${s.slug.padEnd(34)} ${s.code.padEnd(8)} REFUSÉ PAR LE COLLECTEUR (${s.refuse.etat}) : ${s.refuse.motif} — non mesuré`); continue; }
        l.push(`${s.slug.padEnd(34)} ${s.code.padEnd(8)} tuiles ${s.tuiles} (au code ${s.auCode}) · produits ${s.produits} · trous ${s.trous} · apparié(s), téléchargement non décidé : ${s.apparies} · dont adresse officielle déclarée ${s.appariesAvecOfficielle} (la page en déclare ${s.officiellesDeclarees}) · restes ${JSON.stringify(s.restes)}${s.suffixesInconnus ? ` · tuiles à suffixe INCONNU ${s.suffixesInconnus}` : ''}`);
    }
    const t = M.totaux;
    l.push(`\nTOTAL sur ${t.sets} set(s) mesuré(s)${t.refuses ? ` (${t.refuses} refusé(s) par les gardes du collecteur, non comptés)` : ''} : ${t.produits} produits · ${t.trous} trous · ${t.apparies} apparié(s), téléchargement non décidé (${t.trous ? (100 * t.apparies / t.trous).toFixed(1) : '0.0'} % des trous) · ${t.appariesAvecOfficielle} avec une adresse officielle déclarée par la page · restes ${JSON.stringify(t.restes)}`);
    l.push(`Gardes du collecteur rejouées par ses fonctions : ligne de table, tirage du set en base, produits joints. NON rejouées : seuil de taille non jugé : jugé au téléchargement (largeur de l'original ≥ ${largeurMinDe(P.SOURCE)} px), taille de la base (400 Mo) et alerte de blocage de la source (état de l'écriture, hors lecture).`);
    l.push('Aucune requête réseau, aucune écriture. « Apparié » n\'est pas « téléchargeable » : le téléchargement depuis le CDN officiel n\'est pas décidé (voir PIKAQIAN-PASSIF.md).');
    return l.join('\n');
}

module.exports = { mesurer, formater, lireApprises };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main === module) {
    // Un argument inconnu refuse avant toute connexion.
    const args = process.argv.slice(2);
    const inconnus = args.filter(a => !/^--dossier=.+$/.test(a));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — permis : --dossier=<chemin> (défaut ${DOSSIER_DEFAUT})`); process.exit(2); }
    const dossier = args.find(a => a.startsWith('--dossier='))?.slice(10) ?? DOSSIER_DEFAUT;
    (async () => {
        require('dotenv').config();
        const mongoose = require('mongoose');
        const { jugerLecture, verifierPrivilegesLecture, facadeLecture } = require('./collecte-cartes/base-banc');
        const C = require('./collecteur-images-pikaqian');
        process.on('SIGINT', () => process.exit(130));        // le collecteur importé capte SIGINT sans quitter : ici on quitte
        if (!fs.existsSync(dossier)) { console.error(`❌ le dossier « ${dossier} » n'existe pas : aucune page apprise.`); process.exit(1); }
        const j = jugerLecture(process.env, 'cartes', 'la base « cartes » (trous des fiches, mesure PikaQian passive)');
        if (!j.ok) { console.error(j.raison); process.exit(1); }
        const cx = await mongoose.createConnection(j.uri, { dbName: 'cartes', autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 }).asPromise();
        try {
            const v = await verifierPrivilegesLecture(cx.db, 'cartes');
            if (!v.ok) { console.error(v.raison); process.exit(1); }
            const M = await mesurer({ dossier, db: facadeLecture(cx.db), C });
            console.log(formater(M));
        } finally { await cx.close(); }
    })().catch(e => { console.error('❌', e.message); process.exit(1); });
}
