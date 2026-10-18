// ============================================================
// TAMPONS-RELEVE B — POSER LES VARIANTES DES 13 V2 TAMPONNÉS DU RELEVÉ DU TESTEUR + 28 CORRECTIONS (2 du relevé, 18 vues « normale » -> prerelease, 8 vues « staff » -> staff+prerelease) (2026-10-18)
// ============================================================
//   node poser-variantes-releve.js --plan                                        (ESSAI À BLANC, défaut : prouve chaque fiche, imprime les comptes, le diff « servis », l'annonce ; n'écrit rien)
//   node poser-variantes-releve.js --plan --rapport=<f>.json --annonce-vers=<f>.json
//   node lot-additif.js --quoi="TAMPONS-RELEVE B : 13 fiches + 28 corrections" --collections=cartes_produits,cartes,images --annonce=<f> --compte=cartes_produits -- node poser-variantes-releve.js --ecrire --attendu=41
//   node poser-variantes-releve.js --restaurer=<sauvegarde>.json [--ecrire --attendu=<N>]    (remet chaque champ à sa valeur d'avant, s'il porte encore la valeur écrite par ce lot)
// La SAUVEGARDE des valeurs d'avant est écrite AVANT la première écriture (`--sauvegarde-vers=`, par défaut dans le dossier du lot). Les règles vivent dans collecte-cartes/variantes-releve.js.
// JAMAIS de requête réseau. Collections écrites : `cartes_produits`, `cartes`, `images`.
const fs = require('fs');
const path = require('path');
const R = require('./collecte-cartes/variantes-releve');
const T = require('./collecte-cartes/variante-staff');

const LOT = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/TAMPONS-RELEVE/';
const CHEMINS = Object.freeze({ releve: LOT + 'tampons-scans-2026-10-18.csv', export: 'C:/Users/Yung/rat-market-travail/catalogue/c-imports-gha/products_singles_6.json',
    inventaire: 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/STAFF-DETECT/inventaire-etiquettes.json' });
const AUTORISES = [/^--plan$/, /^--ecrire$/, /^--attendu=\d+$/, /^--restaurer=.+\.json$/, /^--sauvegarde-vers=.+\.json$/, /^--annonce-vers=.+\.json$/, /^--rapport=.+\.json$/, /^--releve=.+$/, /^--export=.+$/, /^--inventaire=.+$/];

/** Lit les trois fichiers locaux. Un fichier vide ou à la mauvaise forme LÈVE (un zéro n'est pas un résultat). */
function lireSources(chemins = CHEMINS) {
    const fiches = R.listeDesFiches(R.lireCsv(fs.readFileSync(chemins.releve, 'utf8')));
    const lignesCsv = R.lireCsv(fs.readFileSync(chemins.releve, 'utf8'));
    const ex = JSON.parse(fs.readFileSync(chemins.export, 'utf8'));
    if (!Array.isArray(ex.products) || !ex.products.length) throw new Error(`${chemins.export} : aucun produit`);
    const dates = new Map(ex.products.filter(p => p.dateAdded).map(p => [p.idProduct, p.dateAdded]));
    const inv = JSON.parse(fs.readFileSync(chemins.inventaire, 'utf8'));
    if (!Array.isArray(inv.produits) || !inv.produits.length) throw new Error(`${chemins.inventaire} : aucune étiquette — un inventaire vide ne prouve rien`);
    const etiquettes = new Map(inv.produits.map(p => [p.idProduct, String(p.ocr ? p.ocr.join(' ') : p.classe ?? '')]));
    const corrections = [...R.listeDesCorrections(lignesCsv), ...R.listeDesCorrectionsVues()];
    return { fiches, corrections, dates, etiquettes, idsReleve: new Set(lignesCsv.map(l => l.idProduct)), denominateurs: { produitsExport: ex.products.length, datesLues: dates.size, vignettesInventaire: inv.vignettes, etiquettesInventaire: inv.produits.length, lignesReleve: lignesCsv.length } };
}

async function executer({ cartesDb, regle, sources, ecrire = false, attendu, log = console.log, annonceVers = null, rapport = null, sauvegardeVers = null }) {
    log(`DÉNOMINATEURS : ${JSON.stringify(sources.denominateurs)}`);
    const plan = await R.construirePlan({ cartesDb, fiches: sources.fiches, dates: sources.dates, idsReleve: sources.idsReleve, etiquettes: sources.etiquettes, corrections: sources.corrections });
    const k = plan.comptes, refusFiches = plan.refus.filter(r => !r.motif.startsWith('correction')).length, refusCorr = plan.refus.length - refusFiches;
    log(`\n════ ${k.fiches} FICHES · PROUVÉES ${k.items} · REFUSÉES ${refusFiches} ${k.items + refusFiches === k.fiches ? '' : '🔴 la somme ne fait pas la liste'}════ + ${sources.corrections.length} CORRECTIONS · PROUVÉES ${k.corrections} · REFUSÉES ${refusCorr} (attendu à l'écriture : ${k.items + k.corrections})`);
    for (const r of plan.refus) log(`   ✗ ${r.idProduct} [${r.variante}] : ${r.motif}`);
    for (const c of plan.corrections) log(`   CORRECTION ${c.idProduct} ${c.nom} : « ${c.avant} » → « ${c.vers} »${c.deja ? ' (déjà)' : ''} · entrée(s) d'image NON modifiée(s) : ${JSON.stringify(c.entreesNonModifiees)}`);
    for (const i of plan.items) log(`   ${i.idProduct} ${i.set} ${i.numero} → V2 « ${i.variante} »${i.v2.deja ? ' (déjà)' : ''} · V1 ${i.v1 ? `${i.v1.idProduct} « normale »${i.v1.deja ? ' (déjà)' : ''}` : `non (${i.v1Motif})`} · frères lus à l'œil ${i.freresVus.map(x => `${x.idProduct} « ${x.variante} »`).join(', ') || 'aucun'}${i.freresVusRefus.length ? ` (REFUSÉS : ${i.freresVusRefus.join(' ; ')})` : ''} · autres produits non séparés ${i.autres.join('+') || 'aucun'} · entrée ${i.entree ? `« ${i.entree.cible} »${i.entree.deja ? ' (déjà)' : ''}` : `non (${i.entreeMotif})`}${i.doc ? ' · document oui' : (i.docMotif ? ` · document non (${i.docMotif})` : '')}${i.reserve ? ` · RÉSERVE : ${i.reserve}` : ''}`);
    const op = R.operations(plan);
    log(`   À ÉCRIRE : ${op.lignes.length} ligne(s) cartes_produits (V2 ${plan.items.filter(i => !i.v2.deja).length}, V1 ${plan.items.filter(i => i.v1 && !i.v1.deja).length}, frères lus à l'œil ${plan.items.reduce((n, i) => n + i.freresVus.filter(x => !x.deja).length, 0)}, corrections ${plan.corrections.filter(c => !c.deja).length}) · ${op.entrees.length} entrée(s) cartes.images · ${op.docs.length} document(s) images`);
    // diff « servis » et annonce de lot par les fonctions de la garde (pseudo-plan de la forme que lisent ces fonctions)
    const paires = plan.items.map(i => ({ set: i.set, idNormale: i.v1?.idProduct ?? -1, idEtiquete: i.idProduct,
        lignes: [{ _id: i.v2._id, cible: i.variante, preuve: i.v2.preuve }, ...(i.v1 ? [{ _id: i.v1._id, cible: 'normale', preuve: i.v1.preuve }] : []), ...i.freresVus.map(x => ({ _id: x._id, cible: x.variante, preuve: x.preuve }))],
        entree: i.entree ? { carteId: i.entree.carteId, set: i.entree.set, cleR2: i.entree.cleR2, cible: i.entree.cible } : { carteId: -1, set: '', cleR2: '', cible: '' } }));
    for (const c of plan.corrections) paires.push({ set: c.set, idNormale: -1, idEtiquete: c.idProduct, lignes: [{ _id: c._id, cible: c.vers, preuve: c.preuve }], entree: { carteId: -1, set: '', cleR2: '', cible: '' } });
    const annonces = await T.annonceDePlan(cartesDb, { paires: paires.filter(p => p.entree.carteId !== -1) });
    log(`   ANNONCE DE LOT (fonction de la garde) : ${JSON.stringify(annonces)}`);
    if (annonceVers) { fs.mkdirSync(path.dirname(path.resolve(annonceVers)), { recursive: true }); fs.writeFileSync(annonceVers, JSON.stringify(annonces, null, 1)); log(`   annonce → ${annonceVers}`); }
    const servis = await T.diffServis({ cartesDb, regle, plan: { paires } });
    log(`   SERVIS (règle du site importée) : ${servis.servisAvant}/${servis.produits} produits touchés servis avant, ${servis.servisApres}/${servis.produits} après · perdus ${servis.perdus.length} · fiche changée ${servis.changes.length}`);
    if (servis.perdus.length || servis.changes.length) throw new Error(`le diff « servis » voit ${servis.perdus.length} produit(s) perdu(s) et ${servis.changes.length} fiche(s) changée(s) : rien n'est écrit`);
    if (rapport) { fs.mkdirSync(path.dirname(path.resolve(rapport)), { recursive: true }); fs.writeFileSync(rapport, JSON.stringify({ le: new Date().toISOString(), denominateurs: sources.denominateurs, comptes: k, annonces, servis, items: plan.items, corrections: plan.corrections, refus: plan.refus }, null, 1)); log(`   plan complet → ${rapport}`); }
    const sauvegarder = async obj => {
        const f = sauvegardeVers || `${LOT}sauvegarde-variantes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(obj, null, 1));
        const relu = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (relu.lignes.length !== obj.lignes.length || relu.entrees.length !== obj.entrees.length || relu.docs.length !== obj.docs.length) throw new Error(`sauvegarde ${f} : relue différente de ce qui devait être écrit — rien n'est écrit`);
        log(`   sauvegarde → ${f} (${obj.lignes.length} lignes, ${obj.entrees.length} entrées, ${obj.docs.length} documents)`);
    };
    const r = await R.appliquer(cartesDb, plan, { ecrire, attendu, sauvegarder });
    if (!ecrire) { log(`\n   (essai à blanc — rien n'est écrit${r.dejaFait ? ' ; TOUT EST DÉJÀ ÉCRIT' : ''})`); return { ...r, plan, annonces, servis }; }
    log(`\n   ${r.dejaFait ? '↩️ rien à écrire : tout était déjà écrit (idempotent)' : `✅ écrit : ${r.lignes} ligne(s), ${r.entrees} entrée(s), ${r.documents} document(s)`}`);
    const apres = await R.construirePlan({ cartesDb, fiches: sources.fiches, dates: sources.dates, idsReleve: sources.idsReleve, etiquettes: sources.etiquettes, corrections: sources.corrections });
    const reste = R.operations(apres), bon = apres.items.length === plan.items.length && apres.corrections.length === plan.corrections.length && !reste.lignes.length && !reste.entrees.length && !reste.docs.length;
    log(`   relu : ${reste.lignes.length} ligne(s), ${reste.entrees.length} entrée(s), ${reste.docs.length} document(s) restent à écrire${bon ? '' : '  🔴 DIFFÉRENT DE CE QUI DEVAIT ÊTRE ÉCRIT'}`);
    if (!bon) process.exitCode = 1;
    return { ...r, plan, annonces, servis };
}

module.exports = { executer, lireSources, CHEMINS };

if (require.main === module) {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --plan, --ecrire, --attendu=<N>, --restaurer=<f>.json, --sauvegarde-vers=, --annonce-vers=, --rapport=, --releve=, --export=, --inventaire=`); process.exit(2); }
    const val = n => process.argv.find(x => x.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = process.argv.includes('--ecrire');
    const attendu = val('attendu') !== undefined ? Number(val('attendu')) : undefined;
    if (ecrire && attendu === undefined) { console.error('❌ --ecrire exige --attendu=<N> : rien n\'est écrit'); process.exit(2); }
    (async () => {
        require('dotenv').config();
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const { cartes, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
        try {
            if (val('restaurer')) {
                const r = await R.restaurer(cartes.db, JSON.parse(fs.readFileSync(val('restaurer'), 'utf8')), { ecrire, attendu });
                console.log(`${ecrire ? 'RESTAURÉ' : 'essai à blanc'} : ${r.restaurees}/${r.total} opération(s)${r.changeesDepuis.length ? ` · LAISSÉES (champ changé depuis) : ${r.changeesDepuis.join(', ')}` : ''}`);
                return;
            }
            const X = require('./exporter-donnees-logos-site');
            const regle = await X.regleDuSite(process.env.RACINE_SITE || 'C:/Users/Yung/Desktop/pokemon-proxy');
            const chemins = { ...CHEMINS, ...Object.fromEntries(['releve', 'export', 'inventaire'].filter(n => val(n)).map(n => [n, val(n)])) };
            await executer({ cartesDb: cartes.db, regle, sources: lireSources(chemins), ecrire, attendu, annonceVers: val('annonce-vers') || null, rapport: val('rapport') || null, sauvegardeVers: val('sauvegarde-vers') || null });
        } finally { await fermer(); }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
