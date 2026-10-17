// ============================================================
// RETIRABLE — poser `retirable: true` sur les visuels Bulbapedia SERVIS et les visuels TPC Asie zh-hant (testeur, 2026-10-17)
// ============================================================
//   node poser-retirable.js                                   (SIMULATION, défaut : lit, imprime les comptes, n'écrit RIEN)
//   node lot-additif.js --quoi="retirable : N visuels (Bulbapedia servis, TPC Asie tw)" --collections=cartes,images --compte=images:retirable=true -- node poser-retirable.js --ecrire --attendu=<N>
// <N> = la cohorte lue à la simulation (entrées cartes.images concernées, déjà marquées comprises). --ecrire sans --attendu, ou avec un autre compte, refuse AVANT toute écriture.
// La logique et ses garanties vivent dans collecte-cartes/retirable.js (additif, idempotent, un seul champ). Aucune requête réseau.
const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/];

async function executer({ cartesDb, admis, ecrire = false, attendu, log = console.log }) {
    const R = require('./collecte-cartes/retirable');
    const plan = await R.construirePlan({ cartesDb, admis });
    const c = plan.comptes;
    log(`\n════ DÉNOMINATEUR : cohorte ${c.cohorte} entrée(s) cartes.images (Bulbapedia servies par la règle du site + TPC Asie zh-hant), déjà marquées comprises ════`);
    log(`   entrées à marquer : Bulbapedia ${c.entrees.bulbapedia} · TPC Asie ${c.entrees['tpc-asie']} (déjà marquées : Bulbapedia ${c.entrees.dejaBulbapedia} + TPC ${c.cohorte - c.entrees.bulbapedia - c.entrees['tpc-asie'] - c.entrees.dejaBulbapedia - c.autreValeur})`);
    log(`   documents images à marquer : Bulbapedia ${c.documents.bulbapedia} · TPC Asie ${c.documents['tpc-asie']} (déjà marqués : Bulbapedia ${c.documents.dejaBulbapedia})`);
    log(`   écartées : Bulbapedia refusées par la règle du site ${c.bulbapediaRefuseeParLaRegle} · Bulbapedia sous un set inconnu ${c.bulbapediaSetInconnu} · champ déjà présent avec une autre valeur (jamais écrasé) ${c.autreValeur}`);
    const r = await R.appliquer(cartesDb, plan, { ecrire, attendu });
    if (!ecrire) { log(`\n   (simulation — rien n'est écrit : ${r.entrees} entrée(s) et ${r.documents} document(s) le seraient${r.dejaFait ? ' ; TOUT EST DÉJÀ MARQUÉ' : ''})`); return { ...r, plan }; }
    log(`\n   ${r.dejaFait ? '↩️ rien à écrire : tout était déjà marqué (idempotent)' : `✅ écrit : ${r.entrees} entrée(s) cartes.images, ${r.documents} document(s) images`}`);
    const apres = await R.construirePlan({ cartesDb, admis });
    const bon = apres.entrees.length === 0 && apres.documents.length === 0 && apres.comptes.cohorte === plan.comptes.cohorte;
    log(`   relu : ${apres.entrees.length} entrée(s) et ${apres.documents.length} document(s) restent à marquer, cohorte ${apres.comptes.cohorte}${bon ? '' : '  🔴 DIFFÉRENT DE CE QUI DEVAIT ÊTRE ÉCRIT'}`);
    if (!bon) process.exitCode = 1;
    return { ...r, plan };
}

module.exports = { executer };

if (require.main === module) {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --attendu=<N>`); process.exit(2); }
    const ecrire = process.argv.includes('--ecrire');
    const a = process.argv.find(x => x.startsWith('--attendu='));
    const attendu = a ? Number(a.slice(10)) : undefined;
    if (ecrire && attendu === undefined) { console.error('❌ --ecrire exige --attendu=<N> (la cohorte lue à la simulation) : rien n\'est écrit'); process.exit(2); }
    (async () => {
        require('dotenv').config();
        const X = require('./exporter-donnees-logos-site');
        // la règle du site vit dans le dépôt voisin du dépôt PRINCIPAL (la copie de travail n'a pas de voisin rat-market-site)
        const regle = await X.regleDuSite(process.env.RACINE_SITE || 'C:/Users/Yung/Desktop/pokemon-proxy');
        if (ecrire) {
            const { ouvrirConnexions } = require('./collecte-cartes/garde');
            const { cartes, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
            try { await executer({ cartesDb: cartes.db, admis: regle.visuelAdmisPourLaRegion, ecrire, attendu }); } finally { await fermer(); }
        } else {
            // simulation : la connexion de LECTURE SEULE (aucune écriture possible, même par erreur)
            const { ouvrir } = require('C:/Users/Yung/rat-market-travail/catalogue/scratch/lecture.js');
            const { client, db } = await ouvrir();
            try { await executer({ cartesDb: db, admis: regle.visuelAdmisPourLaRegion, ecrire: false, attendu }); } finally { await client.close(); }
        }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
