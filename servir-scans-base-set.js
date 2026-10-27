// ============================================================
// SERVIR LE SCAN UNLIMITED SANS TAMPON À LA PLACE DU SCAN « EDITION 1 » — 48 fiches Base-Set, liste FERMÉE, feu vert NOMMÉ de l'éditeur, 2026-10-27
// ============================================================
//   node servir-scans-base-set.js [--annonce-vers=<f>.json]                                   (simulation : lecture seule, n'écrit rien)
//   node lot-additif.js --quoi="…" --collections=cartes,images -- node servir-scans-base-set.js --ecrire --attendu=48 --sauvegarde=<f>.json
//   node lot-additif.js --quoi="… RESTAURATION" --collections=cartes,images -- node servir-scans-base-set.js --restaurer=<f>.json --ecrire --attendu=48
// Code de sortie : 0 ok · 1 compte différent de --attendu / refus / relu différent · 2 argument inconnu, ou --ecrire sans --attendu / --sauvegarde.
// Toute la décision vit dans collecte-cartes/servir-scans-base-set.js (testée par test-servir-scans-base-set.js). Après l'écriture, les vignettes des scans servis sont
// fabriquées par la règle commune (vignettes-apres-jointure.js) : la garde de lot voit le même nombre de vignettes dans le set.
// ⚠️ RÉCUPÉRATION (relecture du 27/10) : la restauration automatique de lot-additif.js ne remet PAS la collection `images` (elle est sauvegardée, pas restaurée), et une vignette
// manquante ne fait pas remettre `cartes.images`. Après un arrêt : relancer la SIMULATION (elle dit les fiches « à servir », « à finir », « déjà servies »), puis soit relancer
// l'écriture (elle termine), soit `--restaurer=<sauvegarde>` (reprenable étape par étape). Ne jamais laisser une fiche « à finir » : son document « Edition 1 » encore « ok »
// serait repris par la jointure du scan anglais. Une passe qui ne fait que FINIR des fiches écrit une sauvegarde sans lignes : pour restaurer, prendre la sauvegarde de la passe
// qui a remplacé les entrées (elle seule porte les entrées « Edition 1 » retirées). Risque résiduel nommé : si l'adresse du scan « Edition 1 » change chez sa source, une recollecte
// repasse son document à « ok » et le ferait resservir — relancer alors cette simulation (elle le verrait en « les deux scans » ou « à servir »).
const fs = require('fs');
const path = require('path');
const S = require('./collecte-cartes/servir-scans-base-set');

const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/, /^--sauvegarde=.+\.json$/, /^--restaurer=.+\.json$/, /^--annonce-vers=.+\.json$/, /^--langue$/];

// --langue : la LANGUE lue à l'image, sur les scans déjà servis (simulation, --ecrire --attendu=N --sauvegarde=<f>, --restaurer=<f> --ecrire --attendu=N)
// ⚠️ Après une panne au milieu, une reprise réécrit une NOUVELLE sauvegarde où les documents déjà passés à « en » ont « en » pour valeur d'avant : pour restaurer, prendre
// TOUJOURS la PREMIÈRE sauvegarde de la pose (elle seule porte les vraies valeurs d'avant ; la restauration est reprenable et rend tout).
async function executerLangue({ db, liste = S.LISTE, ecrire = false, attendu, sauvegarde, restaurer: fichierRestaure, garde = null, log = console.log }) {
    if (fichierRestaure) {
        if (ecrire && garde) garde();
        const r = await S.restaurerLangue(db, S.lireSauvegarde(fs.readFileSync(fichierRestaure, 'utf8')), { ecrire, attendu });
        log(ecrire ? `↩️  langue restaurée : ${r.lignes} · relu ${r.relu.rendues}` : `(essai à blanc : ${r.lignes} ligne(s))`);
        if (ecrire && r.relu.rendues !== r.lignes) process.exitCode = 1;
        return r;
    }
    const plan = await S.simulerLangue(db, liste);
    for (const x of plan.refus) log(`   REFUS n°${x.entree.numero} : ${x.raison}`);
    log(`   LANGUE LUE : ${plan.aPoser.length} à poser · ${plan.deja.length} déjà · ${plan.refus.length} refus`);
    if (!ecrire) { log(`   (simulation : rien écrit — relancer avec --langue --ecrire --attendu=${plan.aPoser.length} --sauvegarde=<f>.json, par lot-additif.js --collections=cartes,images)`); return { plan }; }
    if (attendu !== plan.aPoser.length) throw new Error(`ARRÊT : ${plan.aPoser.length} à poser contre ${attendu} attendus — rien n'est écrit`);
    if (plan.refus.length) throw new Error(`ARRÊT : ${plan.refus.length} refus — rien n'est écrit`);
    if (garde) garde();
    const n = await S.poserLangue(db, plan, { sauvegarde, ecrireTexte });
    const reste = (await S.simulerLangue(db, liste)).aPoser.length;
    log(`   ✅ langue posée sur ${n} scan(s) (attendu ${attendu}) · relu : ${reste} restant(s)`);
    if (n !== attendu || reste !== 0) process.exitCode = 1;
    return { plan, n, reste };
}
const ecrireFichier = (f, o) => { fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };
const ecrireTexte = (f, t) => { fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); fs.writeFileSync(f, t); };

async function executer({ db, liste = S.LISTE, ecrire = false, attendu, sauvegarde, restaurer: fichierRestaure, annonceVers = null, garde = null, vignetter = null, log = console.log }) {
    if (fichierRestaure) {
        if (ecrire && garde) garde();
        const r = await S.restaurer(db, S.lireSauvegarde(fs.readFileSync(fichierRestaure, 'utf8')), { ecrire, attendu });
        log(ecrire ? `↩️  restauré : ${r.lignes} fiche(s) · relu : ${r.relu.rendues} entrée(s) « Edition 1 » rendue(s)` : `(essai à blanc — rien n'est écrit : ${r.lignes} fiche(s) seraient restaurées)`);
        if (ecrire && r.relu.rendues !== r.lignes) { process.exitCode = 1; log('🔴 le relu ne correspond pas à la sauvegarde'); }
        return r;
    }
    log(`LISTE FERMÉE : ${liste.length} fiche(s)`);
    const plan = await S.simuler(db, liste);
    for (const x of plan.aServir) log(`   À SERVIR : n°${x.entree.numero} ${x.entree.nom} (carte ${x.entree.carteId}) ${x.entree.cleTcgdex} → ${x.entree.cleBulba} · Unlimited ${x.entree.unlimited.join(',')} · Shadowless ${x.entree.shadowless.join(',')}`);
    for (const x of plan.aFinir) log(`   À FINIR (reprise) : n°${x.entree.numero} ${x.entree.nom} — la carte sert déjà le scan, le document « Edition 1 » est encore « ok »`);
    for (const x of plan.refus) log(`   REFUS n°${x.entree.numero} (carte ${x.entree.carteId}) : ${x.raison}`);
    const total = plan.aServir.length + plan.aFinir.length;
    log(`   ${plan.aServir.length} à servir · ${plan.aFinir.length} à finir · ${plan.refus.length} refus`);
    const ann = S.annonce(plan);
    if (annonceVers) { ecrireFichier(annonceVers, ann); log(`   annonce écrite → ${annonceVers}`); }
    if (!ecrire) { log(`   (simulation : rien écrit — relancer avec --ecrire --attendu=${total} --sauvegarde=<f>.json, par lot-additif.js --collections=cartes,images)`); return { plan, annonce: ann }; }
    if (attendu !== total) throw new Error(`ARRÊT : ${total} fiche(s) à servir ou finir contre ${attendu} attendues — la base a bougé depuis la simulation, rien n'est écrit`);
    const refusBloquants = plan.refus.filter(x => !x.raison.startsWith('déjà servi'));
    if (refusBloquants.length) throw new Error(`ARRÊT : ${refusBloquants.length} refus au plan — rien n'est écrit`);
    if (garde) garde();
    const n = await S.servir(db, plan, { sauvegarde, ecrireTexte });
    const V = vignetter ? await vignetter(db, S.SET) : null;
    if (V) log(`   vignettes : ${JSON.stringify(V.vg)}`);
    const relu = await S.simuler(db, liste), reste = relu.aServir.length + relu.aFinir.length;
    log(`   ✅ ${n} fiche(s) terminée(s) (attendu ${attendu}) · relu : ${reste} restante(s) à servir ou finir`);
    if (n !== attendu || reste !== 0 || (V && (V.vg.erreur || V.vg.echecs))) process.exitCode = 1;
    return { plan, annonce: ann, n, reste, vignettes: V };
}

module.exports = { executer, executerLangue, AUTORISES };

if (require.main === module) {
    const argv = process.argv.slice(2);
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --attendu=N, --sauvegarde=<f>.json, --restaurer=<f>.json, --annonce-vers=<f>.json`); process.exit(2); }
    const val = n => argv.find(x => x.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = argv.includes('--ecrire');
    const attendu = val('attendu') !== undefined ? Number(val('attendu')) : undefined;
    if (ecrire && attendu === undefined) { console.error('❌ --ecrire exige --attendu=N (le compte regardé en simulation)'); process.exit(2); }
    if (ecrire && !val('restaurer') && !val('sauvegarde')) { console.error('❌ --ecrire exige --sauvegarde=<f>.json : rien n\'est écrit'); process.exit(2); }
    (async () => {
        const dotenv = require('dotenv');
        dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
        if (!process.env.MONGODB_CARTES_URI) dotenv.config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env', quiet: true });
        const garde = () => require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid);
        if (ecrire) garde();   // refusé hors lot-additif.js AVANT toute connexion
        let db, fermer;
        if (ecrire) {
            const o = await require('./collecte-cartes/garde').ouvrirConnexions({ production: false, buckets: [] });
            db = o.cartes.db; fermer = o.fermer;
        } else {
            if (!process.env.MONGODB_CARTES_LECTURE_URI) throw new Error('MONGODB_CARTES_LECTURE_URI obligatoire pour la simulation (lecture seule)');
            const { MongoClient } = require('mongodb');
            const c = new MongoClient(process.env.MONGODB_CARTES_LECTURE_URI); await c.connect();
            db = c.db('cartes'); fermer = () => c.close();
        }
        const vignetter = (d, slug) => require('./collecte-cartes/vignettes-apres-jointure').vignetterApresJointure(d, slug, { bucket: process.env.R2_BUCKET_IMAGES });
        try {
            if (argv.includes('--langue')) await executerLangue({ db, ecrire, attendu, sauvegarde: val('sauvegarde'), restaurer: val('restaurer'), garde });
            else await executer({ db, ecrire, attendu, sauvegarde: val('sauvegarde'), restaurer: val('restaurer'), annonceVers: val('annonce-vers') || null, garde, vignetter });
        }
        finally { await fermer(); }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
