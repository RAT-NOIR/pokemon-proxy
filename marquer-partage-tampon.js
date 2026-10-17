// ============================================================
// BS-STAFF — MARQUER « TAMPON NON SÉPARABLE » L'IMAGE SERVIE AUX PAIRES BLACK STAR V1 / V2 (testeur, 2026-10-17)
// ============================================================
//   node marquer-partage-tampon.js                                  (SIMULATION : prouve chaque paire, imprime les comptes et les refus, n'écrit rien)
//   node lot-additif.js --quoi="BS-STAFF : 64 paires Black Star marquées tampon non séparable" --collections=cartes,images -- node marquer-partage-tampon.js --ecrire --attendu=64
//   node marquer-partage-tampon.js --retirer [--ecrire [--attendu=<N>]]   (retire ces trois champs, et seulement eux ; simulation sans --ecrire)
//
// Trois champs, sur l'entrée `cartes.images` servie et sur le document `images` correspondant (sauf s'il sert aussi une entrée d'un autre set ou d'une autre carte) : `produitsPartages: [V1, V2]`,
// `partageeTamponNonSepare: true`, `tamponNonRepresente: 'Staff' | 'Play! Pokémon'`. Le site en tire la mention « tampon non représenté » (demande à l'agent site : DEMANDE-SITE.md).
// La preuve de chaque paire vit dans collecte-cartes/partage-tampon.js. Idempotent. JAMAIS de requête réseau : l'index Pokumon vient du cache (plus de 12 h, on s'arrête). Les collections écrites : `cartes`, `images`
// (les deux à passer à `--collections` du lot) ; la garde de lot compte le groupe `images-partagees-tampon` par set, et un retrait non annoncé est une baisse qui arrête le lot.
const fs = require('fs');
const path = require('path');
const T = require('./collecte-cartes/partage-tampon');

const FICHIER_INDEX = path.join(__dirname, 'collecte-cartes', 'rapports', 'cache-pokumon', 'index-familles.json');
const AUTORISES = [/^--ecrire$/, /^--retirer$/, /^--attendu=\d+$/];

/**
 * @param {{cartesDb: object, prodDb?: object, regle?: object, site?: object, index?: object[], ecrire?: boolean, retirer?: boolean, attendu?: number, log?: Function, rapport?: string|null}} o
 * `cartesDb` : la base `cartes` ; `prodDb` : la production en LECTURE (noms Cardmarket) ; `regle`, `site` : la règle du site importée ; `index` : les entrées Pokumon en cache.
 */
async function executer({ cartesDb, prodDb, regle, site, index, ecrire = false, retirer = false, attendu, log = console.log, rapport = null }) {
    if (retirer) {
        const r = await T.retirer(cartesDb, { ecrire, attendu });
        log(`\n════ RETRAIT du marquage « tampon non séparable » : ${r.entrees} entrée(s) cartes.images, ${r.documents} document(s) images${ecrire ? ' — ÉCRIT' : ' (simulation)'}${r.dejaFait ? ' · rien à retirer (déjà retiré)' : ''} ════`);
        if (ecrire) { const apres = await T.retirer(cartesDb, { ecrire: false }); log(`   relu : ${apres.entrees} entrée(s) et ${apres.documents} document(s) portent encore le marquage`); if (apres.entrees || apres.documents) process.exitCode = 1; }
        return r;
    }
    const plan = await T.construirePlan({ cartesDb, prodDb, regle, site, index });
    const c = plan.comptes;
    log(`\n════ DÉNOMINATEUR : ${c.produits} produits lus dans les promos Black Star (SWSH, SVP, MEP) · ${c.groupes} groupe(s) de 2 produits ou plus (même set, carte, numéro, nom) ════`);
    log(`   PAIRES PROUVÉES : ${c.paires} · REFUSÉES : ${c.refus}${c.paires + c.refus === c.groupes ? '' : '  🔴 la somme ne fait pas le dénominateur'}`);
    const parSet = {}, parTampon = {};
    for (const p of plan.paires) { parSet[p.set] = (parSet[p.set] || 0) + 1; parTampon[p.tampon] = (parTampon[p.tampon] || 0) + 1; }
    log(`   par set ${JSON.stringify(parSet)} · par tampon ${JSON.stringify(parTampon)}`);
    log(`   entrées cartes.images à marquer : ${plan.paires.filter(p => !p.entreeDeja).length} (déjà marquées : ${c.entreesDeja}) · documents images à marquer : ${plan.paires.filter(p => p.doc && !p.docDeja).length} (déjà marqués : ${c.documentsDeja})`);
    log(`   documents NON marqués car ils servent aussi une entrée d'un autre set ou d'une autre carte : ${c.documentsPartages} · documents absents : ${c.documentsAbsents}`);
    if (c.refus) {
        log(`   refus par motif : ${JSON.stringify(c.parMotif)}`);
        for (const r of plan.refus.slice(0, 12)) log(`      ✗ ${r.set} n° ${r.numero} « ${r.nom} » produits ${r.produits.join('+')} : ${r.motif}`);
        if (plan.refus.length > 12) log(`      … (+${plan.refus.length - 12})`);
    }
    if (rapport) { fs.mkdirSync(path.dirname(rapport), { recursive: true }); fs.writeFileSync(rapport, JSON.stringify({ le: new Date().toISOString(), comptes: c, paires: plan.paires, refus: plan.refus }, null, 1)); log(`   plan complet → ${rapport}`); }
    const r = await T.appliquer(cartesDb, plan, { ecrire, attendu });
    if (!ecrire) { log(`\n   (simulation — rien n'est écrit : ${r.entrees} entrée(s) et ${r.documents} document(s) le seraient${r.dejaFait ? ' ; TOUT EST DÉJÀ MARQUÉ' : ''})`); return { ...r, plan }; }
    log(`\n   ${r.dejaFait ? '↩️ rien à écrire : tout était déjà marqué (idempotent)' : `✅ écrit : ${r.entrees} entrée(s) cartes.images, ${r.documents} document(s) images`}`);
    const apres = await T.construirePlan({ cartesDb, prodDb, regle, site, index });
    const bon = apres.paires.length === plan.paires.length && apres.comptes.entreesDeja === apres.paires.length && apres.paires.every(p => !p.doc || p.docDeja);
    log(`   relu : ${apres.comptes.entreesDeja}/${apres.paires.length} entrées et ${apres.comptes.documentsDeja} documents portent le marquage${bon ? '' : '  🔴 DIFFÉRENT DE CE QUI DEVAIT ÊTRE ÉCRIT'}`);
    if (!bon) process.exitCode = 1;
    return { ...r, plan };
}

module.exports = { executer, FICHIER_INDEX };

if (require.main === module) {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --retirer, --attendu=<N>`); process.exit(2); }
    const ecrire = process.argv.includes('--ecrire'), retirer = process.argv.includes('--retirer');
    const a = process.argv.find(x => x.startsWith('--attendu='));
    const attendu = a ? Number(a.slice(10)) : undefined;
    if (ecrire && !retirer && attendu === undefined) { console.error('❌ --ecrire exige --attendu=<N> (le nombre de paires lu à la simulation) : rien n\'est écrit'); process.exit(2); }
    (async () => {
        require('dotenv').config();
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const P = require('./collecte-cartes/pokumon');
        const X = require('./exporter-donnees-logos-site');
        const racine = process.env.RACINE_SITE || __dirname;
        const index = retirer ? null : T.lireIndexFamilles(FICHIER_INDEX).entrees;   // plus de 12 h : arrêt, avant toute connexion
        const { cartes, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
        try {
            const regle = retirer ? null : await X.regleDuSite(racine), site = retirer ? null : await P.chargerRegleDuSite(racine);
            await executer({ cartesDb: cartes.db, prodDb: prod.db, regle, site, index, ecrire, retirer, attendu,
                rapport: path.join(__dirname, 'collecte-cartes', 'rapports', `partage-tampon-${new Date().toISOString().slice(0, 10)}.json`) });
        } finally { await fermer(); }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
