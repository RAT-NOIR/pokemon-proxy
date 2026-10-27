// ============================================================
// DÉTACHER DEUX DOUBLONS LUS (EX Trainer Kit 2, M2 et M6) — liste FERMÉE, feu vert NOMMÉ de l'éditeur, 2026-10-27
// ============================================================
//   node detacher-doublons-lus.js [--annonce-vers=<f>.json]                                    (simulation : lecture seule, n'écrit rien)
//   node lot-additif.js --quoi="…" --collections=cartes,images --annonce=<annonce.json> -- node detacher-doublons-lus.js --ecrire --attendu=2 --sauvegarde=<f>.json
//   node lot-additif.js --quoi="… RESTAURATION" --collections=cartes,images -- node detacher-doublons-lus.js --restaurer=<f>.json --ecrire --attendu=2
// Code de sortie : 0 ok · 1 compte différent de --attendu / refus / relu différent · 2 argument inconnu, ou --ecrire sans --attendu / --sauvegarde.
// Toute la décision vit dans collecte-cartes/detacher-doublons-lus.js (testée par test-detacher-doublons-lus.js). Les objets R2 ne sont PAS effacés.
const fs = require('fs');
const path = require('path');
const D = require('./collecte-cartes/detacher-doublons-lus');

const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/, /^--sauvegarde=.+\.json$/, /^--restaurer=.+\.json$/, /^--annonce-vers=.+\.json$/];
const ecrireFichier = (f, o) => { fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };

async function executer({ db, ecrire = false, attendu, sauvegarde, restaurer: fichierRestaure, annonceVers = null, garde = null, log = console.log, ecrireFichier: ef = ecrireFichier }) {
    if (fichierRestaure) {
        if (ecrire && garde) garde();
        const r = await D.restaurer(db, JSON.parse(fs.readFileSync(fichierRestaure, 'utf8')), { ecrire, attendu });
        log(ecrire ? `↩️  restauré : ${r.lignes} entrée(s) · relu : ${r.relu.rendues} présente(s)` : `(essai à blanc — rien n'est écrit : ${r.lignes} entrée(s) seraient restaurées)`);
        if (ecrire && r.relu.rendues !== r.lignes) { process.exitCode = 1; log('🔴 le relu ne correspond pas à la sauvegarde'); }
        return r;
    }
    log(`LISTE FERMÉE : ${D.LISTE.length} ligne(s)`);
    const plan = await D.simuler(db);
    for (const x of plan.aDetacher) log(`   À DÉTACHER : carte ${x.entree.carteId} ${x.entree.nom} (${x.entree.set}) entrée ${x.entree.cleDetachee}${x.avecVignette ? ' [avec vignette]' : ''} · garde ${x.entree.cleGardee} (${x.entree.numeroGarde})`);
    for (const x of plan.refus) log(`   REFUS carte ${x.entree.carteId} : ${x.raison}`);
    log(`   ${plan.aDetacher.length} à détacher · ${plan.refus.length} refus`);
    const ann = D.annonce(plan);
    log(`ANNONCE des baisses (pour lot-additif --annonce) : ${JSON.stringify(ann)}`);
    if (annonceVers) { ef(annonceVers, ann); log(`   annonce écrite → ${annonceVers}`); }
    if (!ecrire) { log(`   (simulation : rien écrit — relancer avec --ecrire --attendu=${plan.aDetacher.length} --sauvegarde=<f>.json, par lot-additif.js --collections=cartes,images)`); return { plan, annonce: ann }; }
    if (attendu !== plan.aDetacher.length) throw new Error(`ARRÊT : ${plan.aDetacher.length} à détacher contre ${attendu} attendus — la base a bougé depuis la simulation, rien n'est écrit`);
    if (plan.refus.length) throw new Error(`ARRÊT : ${plan.refus.length} refus au plan — rien n'est écrit`);
    if (garde) garde();
    const n = await D.detacher(db, plan, { sauvegarde, ecrireFichier: ef });
    const reste = (await D.simuler(db)).aDetacher.length;
    log(`   ✅ ${n} détachée(s) (attendu ${attendu}) · relu : ${reste} entrée(s) restante(s) à détacher`);
    if (n !== attendu || reste !== 0) process.exitCode = 1;
    return { plan, annonce: ann, n, reste };
}

module.exports = { executer, AUTORISES };

if (require.main === module) {
    const argv = process.argv.slice(2);
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --attendu=N, --sauvegarde=<f>.json, --restaurer=<f>.json, --annonce-vers=<f>.json`); process.exit(2); }
    const val = n => argv.find(x => x.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = argv.includes('--ecrire');
    const attendu = val('attendu') !== undefined ? Number(val('attendu')) : undefined;
    if (ecrire && attendu === undefined) { console.error('❌ --ecrire exige --attendu=N (le compte regardé en simulation)'); process.exit(2); }
    if (ecrire && !val('restaurer') && !val('sauvegarde')) { console.error('❌ --ecrire exige --sauvegarde=<f>.json (les entrées détachées) : rien n\'est écrit'); process.exit(2); }
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
        try { await executer({ db, ecrire, attendu, sauvegarde: val('sauvegarde'), restaurer: val('restaurer'), annonceVers: val('annonce-vers') || null, garde }); }
        finally { await fermer(); }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
