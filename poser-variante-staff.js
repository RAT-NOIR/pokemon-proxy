// ============================================================
// STAFF-ECRITURE — SÉPARER 61 PAIRES BLACK STAR (56 Staff, 5 Jumbo) : `cartes_produits.variante`, `partageeTamponNonSepare: false` (testeur, 2026-10-17)
// ============================================================
//   node poser-variante-staff.js                                       (ESSAI À BLANC, par défaut : prouve chaque paire, imprime les comptes, le diff « servis » et le contrôle des Jumbo, n'écrit rien)
//   node poser-variante-staff.js --annonce-vers=<f>.json               (écrit l'annonce de lot, calculée par la fonction de la garde)
//   node lot-additif.js --quoi="STAFF : 61 paires séparées (56 Staff, 5 Jumbo)" --collections=cartes_produits,cartes,images --annonce=<f> --compte=cartes_produits -- node poser-variante-staff.js --ecrire --attendu=61
//
// MODIFICATIONS accordées NOMMÉMENT par la décision 3 du testeur : `partageeTamponNonSepare` true → false, et « Play! Pokémon » → « Jumbo » (l'ancien libellé gardé dans `tamponNonRepresenteAvant`). Le reste est additif :
// `variante` / `variantePreuve` sur les lignes `cartes_produits`. Les 3 paires non séparables (SV 045, SV 150, SWSH 296) ne bougent pas. La preuve de chaque paire vit dans collecte-cartes/variante-staff.js.
// Idempotent. JAMAIS de requête réseau. Collections écrites : `cartes_produits`, `cartes`, `images` (les trois à passer à `--collections` du lot).
const fs = require('fs');
const path = require('path');
const T = require('./collecte-cartes/variante-staff');

const S7 = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/';
const FICHIERS = Object.freeze({ verdicts: S7 + 'STAFF-DETECT/verdicts-64-paires.json', adresses: S7 + 'CM-PASSIF/ADRESSES-64-PAIRES.json', inventaire: S7 + 'STAFF-DETECT/inventaire-etiquettes.json' });
// Ce que les verdicts DOIVENT donner : un fichier de verdicts qui changerait sans que ce lot soit relu arrête tout.
const ATTENDU_LISTE = Object.freeze({ staff: 56, jumbo: 5, exclues: 3 });
const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/, /^--annonce-vers=.+\.json$/, /^--rapport=.+\.json$/, /^--verdicts=.+\.json$/, /^--adresses=.+\.json$/, /^--inventaire=.+\.json$/];

/**
 * @param {{cartesDb: object, verdicts: object[], adresses: object[], regle: object, jumboIds?: number[], ecrire?: boolean, attendu?: number, log?: Function, annonceVers?: string|null, rapport?: string|null}} o
 */
async function executer({ cartesDb, verdicts, adresses, regle, jumboIds = null, ecrire = false, attendu, log = console.log, annonceVers = null, rapport = null, attenduListe = ATTENDU_LISTE }) {
    const liste = T.listeDesPaires(verdicts, adresses);
    const c = liste.comptes;
    if (c.staff !== attenduListe.staff || c.jumbo !== attenduListe.jumbo || c.exclues !== attenduListe.exclues)
        throw new Error(`les verdicts donnent ${c.staff} Staff / ${c.jumbo} Jumbo / ${c.exclues} exclues au lieu de ${attenduListe.staff} / ${attenduListe.jumbo} / ${attenduListe.exclues} — rien n'est écrit`);
    log(`\n════ LISTE : ${c.staff} paires Staff (dont ${liste.paires.filter(p => p.ruling).length} rulings du coordinateur) + ${c.jumbo} paires Jumbo · ${c.exclues} restent non séparables : ${liste.exclues.map(x => `${x.set.split('-')[0]} ${x.numero}`).join(', ')} ════`);
    const plan = await T.construirePlan({ cartesDb, paires: liste.paires });
    const k = plan.comptes;
    log(`   PAIRES PROUVÉES : ${k.paires} · REFUSÉES : ${k.refus}${k.paires + k.refus === liste.paires.length ? '' : '  🔴 la somme ne fait pas la liste'}`);
    const parSet = {}, parType = {};
    for (const p of plan.paires) { parSet[p.set] = (parSet[p.set] || 0) + 1; parType[p.type] = (parType[p.type] || 0) + 1; }
    log(`   par set ${JSON.stringify(parSet)} · par type ${JSON.stringify(parType)}`);
    const sim = await T.appliquer(cartesDb, plan, { ecrire: false });
    log(`   lignes cartes_produits à écrire : ${sim.lignes} (déjà : ${k.lignesDeja}) · entrées cartes.images : ${sim.entrees} (déjà : ${k.entreesDeja}) · documents images : ${sim.documents} (déjà : ${k.documentsDeja} ; sans document : ${k.documentsAbsents})`);
    if (k.refus) { log(`   refus par motif : ${JSON.stringify(k.parMotif)}`); for (const r of plan.refus) log(`      ✗ ${r.set} n° ${r.numero} « ${r.nom} » : ${r.motif}`); }
    const annonces = await T.annonceDePlan(cartesDb, plan);
    log(`   ANNONCE DE LOT (fonction de la garde) : ${JSON.stringify(annonces)}`);
    if (annonceVers) { fs.mkdirSync(path.dirname(path.resolve(annonceVers)), { recursive: true }); fs.writeFileSync(annonceVers, JSON.stringify(annonces, null, 1)); log(`   annonce → ${annonceVers}`); }
    const servis = await T.diffServis({ cartesDb, regle, plan });
    log(`   SERVIS (règle du site importée) : ${servis.servisAvant}/${servis.produits} produits touchés servis avant, ${servis.servisApres}/${servis.produits} après · perdus ${servis.perdus.length} · fiche changée ${servis.changes.length} · ${JSON.stringify(servis.parSet)}`);
    if (servis.perdus.length || servis.changes.length) throw new Error(`le diff « servis » voit ${servis.perdus.length} produit(s) perdu(s) et ${servis.changes.length} fiche(s) changée(s) : rien n'est écrit`);
    let jumbo = null;
    if (jumboIds) {
        jumbo = await T.controleJumbo({ cartesDb, jumboIds });
        log(`   JUMBO : ${jumbo.total} candidats · marqués ${jumbo.marques} · seuls sur leur fiche ${jumbo.seuls} · entre Jumbo ${jumbo.entreJumbo} · sans ligne ${jumbo.sansLigne} · CONFONDUS ${jumbo.confondus.length}`);
        for (const x of jumbo.confondus) log(`      ⚠️ ${x.idProduct} (${x.slugSet} ${x.numeroFiche}, carte ${x.carteId}) partage ${x.par === 'fiche' ? 'la fiche' : "l'image"} de ${x.normaux.join('+')} sans marquage`);
    }
    if (rapport) { fs.mkdirSync(path.dirname(path.resolve(rapport)), { recursive: true }); fs.writeFileSync(rapport, JSON.stringify({ le: new Date().toISOString(), comptes: k, annonces, servis, jumbo, paires: plan.paires, refus: plan.refus, exclues: liste.exclues }, null, 1)); log(`   plan complet → ${rapport}`); }
    const r = await T.appliquer(cartesDb, plan, { ecrire, attendu });
    if (!ecrire) { log(`\n   (essai à blanc — rien n'est écrit : ${r.lignes} ligne(s), ${r.entrees} entrée(s) et ${r.documents} document(s) le seraient${r.dejaFait ? ' ; TOUT EST DÉJÀ ÉCRIT' : ''})`); return { ...r, plan, annonces, servis, jumbo }; }
    log(`\n   ${r.dejaFait ? '↩️ rien à écrire : tout était déjà écrit (idempotent)' : `✅ écrit : ${r.lignes} ligne(s) cartes_produits, ${r.entrees} entrée(s) cartes.images, ${r.documents} document(s) images`}`);
    const apres = await T.construirePlan({ cartesDb, paires: liste.paires });
    const bon = apres.paires.length === plan.paires.length && apres.comptes.entreesDeja === apres.paires.length && apres.paires.every(p => p.lignes.every(l => l.deja) && (!p.doc || p.doc.deja));
    log(`   relu : ${apres.comptes.entreesDeja}/${apres.paires.length} entrées, ${apres.comptes.lignesDeja} lignes et ${apres.comptes.documentsDeja} documents portent l'état final${bon ? '' : '  🔴 DIFFÉRENT DE CE QUI DEVAIT ÊTRE ÉCRIT'}`);
    if (!bon) process.exitCode = 1;
    return { ...r, plan, annonces, servis, jumbo };
}

/** Les idProduct des candidats Jumbo de l'inventaire (classe « jumbo »), plus les V2 des paires Jumbo. */
function jumboDeLInventaire(inventaire, paires) {
    const ids = inventaire?.idsParClasse?.jumbo;
    if (!Array.isArray(ids) || !ids.length) throw new Error('inventaire : idsParClasse.jumbo absent ou vide — un contrôle sans candidats ne prouve rien');
    return [...new Set([...ids, ...paires.filter(p => p.type === 'jumbo').map(p => p.idEtiquete)])];
}

module.exports = { executer, jumboDeLInventaire, FICHIERS, ATTENDU_LISTE };

if (require.main === module) {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --attendu=<N>, --annonce-vers=<f>.json, --rapport=<f>.json, --verdicts=, --adresses=, --inventaire=`); process.exit(2); }
    const val = n => process.argv.find(x => x.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = process.argv.includes('--ecrire');
    const attendu = val('attendu') !== undefined ? Number(val('attendu')) : undefined;
    if (ecrire && attendu === undefined) { console.error('❌ --ecrire exige --attendu=<N> (le nombre de paires lu à l\'essai à blanc) : rien n\'est écrit'); process.exit(2); }
    (async () => {
        require('dotenv').config();
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const X = require('./exporter-donnees-logos-site');
        const lireJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
        const verdicts = lireJson(val('verdicts') || FICHIERS.verdicts), adresses = lireJson(val('adresses') || FICHIERS.adresses);
        const racine = process.env.RACINE_SITE || 'C:/Users/Yung/Desktop/pokemon-proxy';
        const regle = await X.regleDuSite(racine);   // une règle du site qui ne se charge pas LÈVE : sans elle, le diff « servis » ne conclut pas
        const jumboIds = ecrire ? null : jumboDeLInventaire(lireJson(val('inventaire') || FICHIERS.inventaire), T.listeDesPaires(verdicts, adresses).paires);
        const { cartes, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
        try { await executer({ cartesDb: cartes.db, verdicts, adresses, regle, jumboIds, ecrire, attendu, annonceVers: val('annonce-vers') || null, rapport: val('rapport') || null }); }
        finally { await fermer(); }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
