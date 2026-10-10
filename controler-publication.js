// node controler-publication.js — LECTURE SEULE sur la vraie base `cartes` : « un set publié contient-il une fiche sans nom ? un set à cartes est-il sans nom ? »
// La même fonction que le banc (collecte-cartes/controle-publication.js, test-publication-sans-trou.js). Imprime son dénominateur ; code de sortie 1 si > 0.
// Décision du testeur (2026-10-08, EX-TRAINER-KIT-2) : un set ne se publie jamais à moitié créé. Remède d'un set sans nom : node rapatrier-noms-sets.js (dry-run puis --ecrire sous lot-additif.js).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { chargerSite, controlerPublication } = require('./collecte-cartes/controle-publication');

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions();
    try {
        const site = await chargerSite();
        const r = await controlerPublication(cx.db, site);
        const d = r.denominateurs;
        console.log(`DÉNOMINATEURS : ${d.sets} sets · ${d.setsPublies} publiés (nomAffichage chaîne) · ${d.setsSansNom} sans nom · ${d.cartes} cartes · ${d.fichesDansSetsPublies} fiches affichables dans les sets publiés · ${d.lignes} lignes de jointure dont ${d.lignesDansSetsPublies} dans un set publié`);
        console.log(`   fiches SANS NOM dans un set publié : ${r.fichesSansNom.length}${r.fichesSansNom.length ? '\n' + r.fichesSansNom.slice(0, 50).map(x => `      ${x.set} · carte ${x.carteId}`).join('\n') : ''}`);
        console.log(`   lignes d'un set publié vers une carte sans nom ou absente : ${r.lignesSansFiche.length}${r.lignesSansFiche.length ? '\n' + r.lignesSansFiche.slice(0, 50).map(x => `      ${x.set} · ${x.ligne} (${x.raison})`).join('\n') : ''}`);
        console.log(`   sets SANS NOM qui portent des cartes ou des lignes : ${r.setsSansNomAvecCartes.length}${r.setsSansNomAvecCartes.length ? '\n' + r.setsSansNomAvecCartes.map(x => `      ${x.set} · ${x.cartes} cartes · ${x.lignes} lignes`).join('\n') : ''}`);
        console.log(r.ok ? '\n✅ AUCUN trou de publication' : '\n🔴 TROU(S) DE PUBLICATION');
        await fermer();
        process.exit(r.ok ? 0 : 1);
    } catch (e) { console.error('❌', e.message); await fermer(); process.exit(2); }
})();
