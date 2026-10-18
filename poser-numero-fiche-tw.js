// ============================================================
// TAIWAN — poser `numeroFiche` sur les 44 lignes des « Traditional Chinese Products » (testeur, 2026-10-18 : « feu vert pour poser numeroFiche sur les 44 lignes (essai à blanc, écriture, revérification) »)
// ============================================================
//   node poser-numero-fiche-tw.js [--rapport=<f>.json] [--site-lib=<lib du site>]             (ESSAI À BLANC, défaut : plan, 45e et sa raison, diff « servi » par la règle du site importée, garde de lot ; n'écrit rien)
//   node lot-additif.js --quoi="TAIWAN : numeroFiche des 44 Traditional Chinese Products" --collections=cartes_produits -- node poser-numero-fiche-tw.js --ecrire --attendu=44 --sauvegarde=<f>.json
//   node lot-additif.js --quoi="TAIWAN : RESTAURATION" --collections=cartes_produits -- node poser-numero-fiche-tw.js --restaurer=<f>.json --ecrire --attendu=44
// La forme et sa preuve vivent dans collecte-cartes/numero-fiche-tw.js (ruling). MODIFIE `cartes_produits` (numeroFiche null → liste + numéro ; + `numeroFichePreuve`, champ neuf) : feu vert nommé du 2026-10-18.
// Écrit par ce qu'il autorise : un update conditionnel (la ligne porte encore numeroFiche null), `--attendu` obligatoire, sauvegarde AVANT la première écriture, compte réel relu. JAMAIS de requête réseau.
const fs = require('fs');
const path = require('path');
const N = require('./collecte-cartes/numero-fiche-tw');
const G = require('./collecte-cartes/garde-lot');

const SLUG = 'Traditional-Chinese-Products';
const ATTENDU_LIGNES = 45;      // la mesure du 2026-10-18 : 45 lignes, 44 numérotées par leur slug
const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/, /^--sauvegarde=.+\.json$/, /^--restaurer=.+\.json$/, /^--rapport=.+\.json$/, /^--site-lib=.+$/];

const lireLignes = cartesDb => cartesDb.collection('cartes_produits').find({ slugSet: SLUG }).toArray();

/** Le diff « servi » : la fiche que la règle du site (IMPORTÉE) donne à chaque produit de l'expansion, avant / après la pose. Rien ne doit être perdu, rien ne doit changer. */
async function diffServi({ cartesDb, regle, pose }) {
    const X = require('./exporter-donnees-logos-site');
    const set = await cartesDb.collection('sets').findOne({ _id: SLUG });
    if (!set) throw new Error(`le set ${SLUG} est introuvable`);
    const exps = [].concat(set.idExpansion ?? []);
    const lignes = await lireLignes(cartesDb);
    const docs = (await cartesDb.collection('cartes').find({ sets: SLUG }).toArray()).filter(d => typeof d.nomEn === 'string' && d.nomEn);
    const ids = new Set(docs.map(d => d._id));
    const lig = lignes.filter(x => ids.has(x.carteId) && exps.includes(x.idExpansion));
    const cibles = new Map(pose.map(p => [p._id, p]));
    const avant = X.fichesDesProduits(regle, set, docs, lig).fiche;
    const apres = X.fichesDesProduits(regle, set, docs, lig.map(l => cibles.has(l._id) ? { ...l, numeroFiche: cibles.get(l._id).numeroFiche } : l)).fiche;
    const perdus = [...avant.keys()].filter(id => !apres.has(id)), gagnes = [...apres.keys()].filter(id => !avant.has(id));
    const changes = [...avant.keys()].filter(id => apres.has(id) && JSON.stringify(avant.get(id)) !== JSON.stringify(apres.get(id)));
    const touches = new Set(pose.map(p => p.idProduct));
    const avecImage = docs.reduce((n, d) => n + (d.images || []).filter(m => m && m.set === SLUG && m.cleR2).length, 0);
    return { produitsDuSet: avant.size, touches: touches.size, servisAvant: [...touches].filter(id => avant.has(id)).length, servisApres: [...touches].filter(id => apres.has(id)).length, perdus, gagnes, changes, imagesDuSet: avecImage, fichesNumerotees: docs.filter(d => (d.impressions || []).some(i => i && i.tirage === (set.tirage ?? set.region) && [].concat(set.bulba?.expansion ?? []).includes(i.expansion) && i.numero != null)).length };
}

/** La garde de lot rejouée sur l'avant / après simulé : une baisse de groupe se déclare (`--annonce`) ; ici le numeroFiche ne fait bouger aucun compteur. */
function gardeSimulee(lignes, pose) {
    const cibles = new Map(pose.map(p => [p._id, p]));
    const apres = lignes.map(l => cibles.has(l._id) ? { ...l, numeroFiche: cibles.get(l._id).numeroFiche } : l);
    const cmp = G.comparer(G.compterEtat({ cartesProduits: lignes }), G.compterEtat({ cartesProduits: apres }));
    const sets = G.setsTouches({ avant: { cartes: [], cartesProduits: lignes, sets: [] }, apres: { cartes: [], cartesProduits: apres, sets: [] } });
    return { baisses: cmp.baisses.length, nonAutorisees: cmp.nonAutorisees.length, setsTouches: sets.sets };
}

/** Combien de lignes du set portent encore (ou déjà) le numeroFiche du plan. */
async function relire(cartesDb, pose) {
    const lignes = await lireLignes(cartesDb);
    const par = new Map(lignes.map(l => [l._id, l]));
    return { poses: pose.filter(p => par.get(p._id)?.numeroFiche === p.numeroFiche).length, nuls: pose.filter(p => (par.get(p._id)?.numeroFiche ?? null) === null).length };
}

async function appliquer(cartesDb, plan, { ecrire = false, attendu, sauvegarde } = {}) {
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> (le nombre de lignes lu à l\'essai à blanc) : rien n\'est écrit');
    if (attendu !== undefined && attendu !== null && attendu !== plan.pose.length) throw new Error(`--attendu=${attendu} mais ${plan.pose.length} ligne(s) prouvée(s) : rien n'est écrit`);
    const r = { lignes: plan.pose.length, dejaFait: !plan.pose.length };
    if (!ecrire) return r;
    if (!plan.pose.length) return { ...r, relu: { poses: 0, nuls: 0 } };
    if (!sauvegarde) throw new Error('--ecrire exige une sauvegarde des valeurs d\'avant (--sauvegarde=<f>.json) : rien n\'est écrit');
    fs.mkdirSync(path.dirname(path.resolve(sauvegarde)), { recursive: true });
    fs.writeFileSync(sauvegarde, JSON.stringify({ le: new Date().toISOString(), quoi: 'valeurs d\'avant de la pose de numeroFiche (poser-numero-fiche-tw.js)', set: SLUG, lignes: plan.pose.map(p => ({ _id: p._id, idProduct: p.idProduct, numeroFiche: null, numeroFichePose: p.numeroFiche })) }, null, 1));
    for (const p of plan.pose) {
        const res = await cartesDb.collection('cartes_produits').updateOne({ _id: p._id, slugSet: SLUG, idProduct: p.idProduct, numeroFiche: null }, { $set: { numeroFiche: p.numeroFiche, numeroFichePreuve: p.preuve } });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`ligne introuvable, déjà numérotée ou inchangée : ${p._id} — arrêt (rejouer : idempotent ; --restaurer remet l'avant)`);
    }
    return { ...r, relu: await relire(cartesDb, plan.pose) };
}

/** Remet `numeroFiche: null` et retire `numeroFichePreuve`, seulement là où la ligne porte encore la valeur posée. */
async function restaurer(cartesDb, fichier, { ecrire = false, attendu } = {}) {
    const lignes = JSON.parse(fs.readFileSync(fichier, 'utf8')).lignes;
    if (!Array.isArray(lignes) || !lignes.length) throw new Error(`${fichier} : aucune ligne à restaurer`);
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--restaurer --ecrire exige --attendu=<N> : rien n\'est écrit');
    if (attendu !== undefined && attendu !== null && attendu !== lignes.length) throw new Error(`--attendu=${attendu} mais ${lignes.length} ligne(s) dans la sauvegarde : rien n'est écrit`);
    if (!ecrire) return { lignes: lignes.length };
    for (const l of lignes) {
        const res = await cartesDb.collection('cartes_produits').updateOne({ _id: l._id, slugSet: SLUG, numeroFiche: l.numeroFichePose }, { $set: { numeroFiche: null }, $unset: { numeroFichePreuve: '' } });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`ligne introuvable ou déjà restaurée : ${l._id} — arrêt`);
    }
    const par = new Map((await lireLignes(cartesDb)).map(x => [x._id, x]));
    return { lignes: lignes.length, relu: { nuls: lignes.filter(l => (par.get(l._id)?.numeroFiche ?? null) === null && par.get(l._id)?.numeroFichePreuve === undefined).length } };
}

async function executer({ cartesDb, regle, ecrire = false, attendu, sauvegarde, restaurer: fichierRestaure, rapport = null, log = console.log, attenduLignes = ATTENDU_LIGNES }) {
    if (fichierRestaure) {
        const r = await restaurer(cartesDb, fichierRestaure, { ecrire, attendu });
        log(ecrire ? `↩️  restauré : ${r.lignes} ligne(s) · relu : ${r.relu.nuls} sans numeroFiche ni preuve` : `(essai à blanc — rien n'est écrit : ${r.lignes} ligne(s) seraient restaurées)`);
        if (ecrire && r.relu.nuls !== r.lignes) { process.exitCode = 1; log('🔴 le relu ne correspond pas à la sauvegarde'); }
        return r;
    }
    const lignes = await lireLignes(cartesDb);
    if (lignes.length !== attenduLignes) throw new Error(`le set ${SLUG} compte ${lignes.length} ligne(s) au lieu de ${attenduLignes} — rien n'est écrit (relire la mesure)`);
    const plan = N.planDesLignes(lignes);
    const k = plan.comptes;
    log(`\n════ TAIWAN numeroFiche : ${k.lignes} lignes · ${k.pose} à numéroter ${JSON.stringify(k.parListe)} par ${JSON.stringify(k.parVoie)} · laissées ${k.laissees} ${JSON.stringify(k.parMotif)} ════`);
    for (const l of plan.laissees) log(`      ✗ ${l.idProduct} « ${l.slug} » : ${l.motif}${l.numeroFiche ? ` (${l.numeroFiche})` : ''}`);
    const deduits = plan.pose.filter(p => p.voie !== 'slug');
    log(`   liste DÉDUITE (slug sans code de liste) : ${deduits.length} → ${deduits.map(p => p.numeroFiche).join(', ')}`);
    const listes = {}; for (const p of plan.pose) (listes[p.numeroFiche] ||= []).push(p.idProduct);
    log(`   numéros distincts : ${Object.keys(listes).length} pour ${plan.pose.length} lignes (les doublons sont des produits d'une MÊME carte)`);
    const garde = gardeSimulee(lignes, plan.pose);
    log(`   GARDE DE LOT (simulée) : ${garde.baisses} baisse(s), ${garde.nonAutorisees} non autorisée(s) → ${garde.baisses ? 'annonce à écrire' : 'aucune annonce nécessaire'} · sets touchés (revalidation) : ${garde.setsTouches.join(', ')}`);
    const servi = await diffServi({ cartesDb, regle, pose: plan.pose });
    log(`   SERVI (règle du site importée) : ${servi.servisAvant}/${servi.touches} produits touchés servis avant, ${servi.servisApres}/${servi.touches} après · perdus ${servi.perdus.length} · gagnés ${servi.gagnes.length} · fiche changée ${servi.changes.length} · images du set ${servi.imagesDuSet} · cartes à fiche numérotée dans ce set ${servi.fichesNumerotees}`);
    if (servi.perdus.length || servi.changes.length) throw new Error(`le diff « servi » voit ${servi.perdus.length} produit(s) perdu(s) et ${servi.changes.length} fiche(s) changée(s) : rien n'est écrit`);
    if (rapport) { fs.mkdirSync(path.dirname(path.resolve(rapport)), { recursive: true }); fs.writeFileSync(rapport, JSON.stringify({ le: new Date().toISOString(), comptes: k, garde, servi, pose: plan.pose, laissees: plan.laissees }, null, 1)); log(`   plan complet → ${rapport}`); }
    const r = await appliquer(cartesDb, plan, { ecrire, attendu, sauvegarde });
    if (!ecrire) { log(`\n   (essai à blanc — rien n'est écrit : ${r.lignes} ligne(s) le seraient${r.dejaFait ? ' ; RIEN À ÉCRIRE' : ''})`); return { ...r, plan, garde, servi }; }
    log(`\n   ${r.dejaFait ? '↩️ rien à écrire (idempotent)' : `✅ écrit : ${r.lignes} ligne(s)`} · relu : ${r.relu.poses} portent leur numeroFiche, ${r.relu.nuls} sont encore nulles (attendu ${plan.pose.length} / 0)`);
    if (!r.dejaFait && (r.relu.poses !== plan.pose.length || r.relu.nuls !== 0)) { process.exitCode = 1; log('🔴 DIFFÉRENT DE CE QUI DEVAIT ÊTRE ÉCRIT'); }
    return { ...r, plan, garde, servi };
}

module.exports = { executer, appliquer, restaurer, diffServi, gardeSimulee, SLUG, ATTENDU_LIGNES };

if (require.main === module) {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --attendu=<N>, --sauvegarde=<f>.json, --restaurer=<f>.json, --rapport=<f>.json, --site-lib=<lib>`); process.exit(2); }
    const val = n => process.argv.find(x => x.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = process.argv.includes('--ecrire');
    const attendu = val('attendu') !== undefined ? Number(val('attendu')) : undefined;
    if (ecrire && attendu === undefined) { console.error('❌ --ecrire exige --attendu=<N> : rien n\'est écrit'); process.exit(2); }
    if (ecrire && !val('restaurer') && !val('sauvegarde')) { console.error('❌ --ecrire exige --sauvegarde=<f>.json (les valeurs d\'avant) : rien n\'est écrit'); process.exit(2); }
    (async () => {
        require('dotenv').config();
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const X = require('./exporter-donnees-logos-site');
        const regle = val('restaurer') ? null : await X.regleDuSite(process.env.RACINE_SITE || 'C:/Users/Yung/Desktop/pokemon-proxy', val('site-lib') || null);
        const { cartes, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
        try { await executer({ cartesDb: cartes.db, regle, ecrire, attendu, sauvegarde: val('sauvegarde'), restaurer: val('restaurer'), rapport: val('rapport') || null }); }
        finally { await fermer(); }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
