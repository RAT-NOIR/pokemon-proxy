// ============================================================
// `numeroFiche` AVEC SA LETTRE (« 84 » → « 84a ») — feu vert NOMMÉ de l'éditeur, 2026-10-27 (MODIFICATION traçable et réversible)
// ============================================================
//   node poser-numero-fiche-lettre.js [--produits=321170,…] [--rapport=<f>.json]            (ESSAI À BLANC, défaut : lecture seule, n'écrit rien)
//   node lot-additif.js --quoi="numeroFiche avec lettre : N" --collections=cartes_produits -- node poser-numero-fiche-lettre.js --ecrire --attendu=N --sauvegarde=<f>.json [--produits=…]
//   node lot-additif.js --quoi="numeroFiche avec lettre : RESTAURATION" --collections=cartes_produits -- node poser-numero-fiche-lettre.js --restaurer=<f>.json --ecrire --attendu=N
// La liste fermée vient de S8\PRIORITES\yellow-a-base.json ; la base est RELUE (lecture) pour l'état courant. La forme et ses gardes vivent dans collecte-cartes/numero-fiche-lettre.js.
// Écrit par ce qu'il autorise : un update CONDITIONNEL {_id, idProduct, numeroFiche: <avant>}, `--attendu` obligatoire (= le plan filtré), sauvegarde AVANT la première écriture, compte réel relu.
// `$set { numeroFiche, numeroFicheAvant, numeroFichePreuve }`. JAMAIS de requête réseau. --ecrire hors lot-additif.js : refusé avant toute connexion.
const fs = require('fs');
const path = require('path');
const N = require('./collecte-cartes/numero-fiche-lettre');
const G = require('./collecte-cartes/garde-lot');

const LISTE_FERMEE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/PRIORITES/yellow-a-base.json';
const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/, /^--sauvegarde=.+\.json$/, /^--restaurer=.+\.json$/, /^--rapport=.+\.json$/, /^--produits=\d+(,\d+)*$/];

/** Les lignes cartes_produits des produits de la liste (lecture). @returns {Promise<Map<number, object[]>>} */
async function lireLignes(cartesDb, produits) {
    const ids = [...new Set(produits.map(p => p.idProduct))];
    const lignes = await cartesDb.collection('cartes_produits').find({ idProduct: { $in: ids } }).toArray();
    const par = new Map();
    for (const l of lignes) par.set(l.idProduct, [...(par.get(l.idProduct) || []), l]);
    return par;
}

/** La garde de lot rejouée sur l'avant / après simulé (aucun compteur ne baisse ; les sets touchés sont revalidés). */
function gardeSimulee(lignesAvant, pose) {
    const cibles = new Map(pose.map(p => [p._id, p]));
    const apres = lignesAvant.map(l => cibles.has(l._id) ? { ...l, numeroFiche: cibles.get(l._id).numeroFiche } : l);
    const cmp = G.comparer(G.compterEtat({ cartesProduits: lignesAvant }), G.compterEtat({ cartesProduits: apres }));
    const sets = G.setsTouches({ avant: { cartes: [], cartesProduits: lignesAvant, sets: [] }, apres: { cartes: [], cartesProduits: apres, sets: [] } });
    return { baisses: cmp.baisses.length, nonAutorisees: cmp.nonAutorisees.length, setsTouches: sets.sets };
}

/** Combien de lignes du plan portent maintenant leur numeroFiche. */
async function relire(cartesDb, pose) {
    const lignes = await cartesDb.collection('cartes_produits').find({ _id: { $in: pose.map(p => p._id) } }).toArray();
    const par = new Map(lignes.map(l => [l._id, l]));
    return { poses: pose.filter(p => par.get(p._id)?.numeroFiche === p.numeroFiche).length };
}

async function appliquer(cartesDb, plan, { ecrire = false, attendu, sauvegarde } = {}) {
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> (le nombre lu à l\'essai à blanc) : rien n\'est écrit');
    if (attendu !== undefined && attendu !== null && attendu !== plan.pose.length) throw new Error(`--attendu=${attendu} mais ${plan.pose.length} ligne(s) au plan : rien n'est écrit`);
    const r = { lignes: plan.pose.length, dejaFait: !plan.pose.length };
    if (!ecrire) return r;
    if (!plan.pose.length) return { ...r, relu: { poses: 0 } };
    if (!sauvegarde) throw new Error('--ecrire exige une sauvegarde des valeurs d\'avant (--sauvegarde=<f>.json) : rien n\'est écrit');
    fs.mkdirSync(path.dirname(path.resolve(sauvegarde)), { recursive: true });
    fs.writeFileSync(sauvegarde, JSON.stringify({ le: new Date().toISOString(), quoi: 'valeurs d\'avant de la pose de numeroFiche avec lettre (poser-numero-fiche-lettre.js)', lignes: plan.pose.map(p => ({ _id: p._id, idProduct: p.idProduct, slugSet: p.slugSet, avant: p.avant, pose: p.numeroFiche })) }, null, 1));
    for (const p of plan.pose) {
        const res = await cartesDb.collection('cartes_produits').updateOne({ _id: p._id, idProduct: p.idProduct, numeroFiche: p.avant }, { $set: { numeroFiche: p.numeroFiche, numeroFicheAvant: p.avant, numeroFichePreuve: p.preuve } });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`ligne introuvable, valeur changée depuis le plan ou inchangée : ${p._id} — arrêt (rejouer : idempotent ; --restaurer remet l'avant)`);
    }
    return { ...r, relu: await relire(cartesDb, plan.pose) };
}

/** Remet numeroFiche à l'avant, retire numeroFicheAvant et numeroFichePreuve, seulement là où la ligne porte encore la valeur posée. */
async function restaurer(cartesDb, fichier, { ecrire = false, attendu } = {}) {
    const lignes = JSON.parse(fs.readFileSync(fichier, 'utf8')).lignes;
    if (!Array.isArray(lignes) || !lignes.length) throw new Error(`${fichier} : aucune ligne à restaurer`);
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--restaurer --ecrire exige --attendu=<N> : rien n\'est écrit');
    if (attendu !== undefined && attendu !== null && attendu !== lignes.length) throw new Error(`--attendu=${attendu} mais ${lignes.length} ligne(s) dans la sauvegarde : rien n'est écrit`);
    if (!ecrire) return { lignes: lignes.length };
    for (const l of lignes) {
        const res = await cartesDb.collection('cartes_produits').updateOne({ _id: l._id, idProduct: l.idProduct, numeroFiche: l.pose }, { $set: { numeroFiche: l.avant ?? null }, $unset: { numeroFicheAvant: '', numeroFichePreuve: '' } });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`ligne introuvable ou déjà restaurée : ${l._id} — arrêt`);
    }
    const par = new Map((await cartesDb.collection('cartes_produits').find({ _id: { $in: lignes.map(l => l._id) } }).toArray()).map(x => [x._id, x]));
    return { lignes: lignes.length, relu: { restaurees: lignes.filter(l => (par.get(l._id)?.numeroFiche ?? null) === (l.avant ?? null) && par.get(l._id)?.numeroFichePreuve === undefined && par.get(l._id)?.numeroFicheAvant === undefined).length } };
}

async function executer({ cartesDb, produits, produitsFiltre = null, ecrire = false, attendu, sauvegarde, restaurer: fichierRestaure, rapport = null, garde = null, log = console.log }) {
    if (fichierRestaure) {
        if (ecrire && garde) garde();
        const r = await restaurer(cartesDb, fichierRestaure, { ecrire, attendu });
        log(ecrire ? `↩️  restauré : ${r.lignes} ligne(s) · relu : ${r.relu.restaurees} remises à l'avant, sans trace` : `(essai à blanc — rien n'est écrit : ${r.lignes} ligne(s) seraient restaurées)`);
        if (ecrire && r.relu.restaurees !== r.lignes) { process.exitCode = 1; log('🔴 le relu ne correspond pas à la sauvegarde'); }
        return r;
    }
    let liste = produits;
    if (produitsFiltre) {
        const connus = new Set(produits.map(p => p.idProduct));
        const hors = produitsFiltre.filter(id => !connus.has(id));
        if (hors.length) throw new Error(`idProduct hors de la liste fermée : ${hors.join(', ')} — rien n'est écrit`);
        const f = new Set(produitsFiltre);
        liste = produits.filter(p => f.has(p.idProduct));
    }
    const lignesParProduit = await lireLignes(cartesDb, liste);
    const plan = N.planifier(liste, lignesParProduit);
    const k = plan.comptes;
    log(`\n════ numeroFiche AVEC LETTRE · liste : ${produits.length} produit(s)${produitsFiltre ? ` · filtre --produits : ${liste.length}` : ''} ════`);
    log(`   PLAN : ${k.pose} à écrire · ${k.deja} déjà fait · ${k.refus} refus ${JSON.stringify(k.parRaison)}`);
    for (const p of plan.pose) log(`      ✎ ${p.idProduct} ${p.carte} (${p.slugSet}) : ${p.avant === null ? '(vide)' : `« ${p.avant} »`} → « ${p.numeroFiche} »`);
    for (const x of plan.refus) log(`      ✗ ${x.idProduct} ${x.carte ?? ''} : ${x.raison}`);
    const touchees = new Set(plan.pose.map(p => p._id));
    const lignesAvant = [...lignesParProduit.values()].flat().filter(l => touchees.has(l._id));
    const g = gardeSimulee(lignesAvant, plan.pose);
    log(`   GARDE DE LOT (simulée) : ${g.baisses} baisse(s), ${g.nonAutorisees} non autorisée(s) → ${g.baisses ? 'annonce à écrire' : 'aucune annonce nécessaire'} · sets touchés (revalidation) : ${g.setsTouches.join(', ') || '—'}`);
    if (rapport) { fs.mkdirSync(path.dirname(path.resolve(rapport)), { recursive: true }); fs.writeFileSync(rapport, JSON.stringify({ le: new Date().toISOString(), comptes: k, garde: g, pose: plan.pose, deja: plan.deja, refus: plan.refus }, null, 1)); log(`   plan complet → ${rapport}`); }
    if (ecrire && garde) garde();
    const r = await appliquer(cartesDb, plan, { ecrire, attendu, sauvegarde });
    if (!ecrire) { log(`\n   (essai à blanc — rien n'est écrit : ${r.lignes} ligne(s) le seraient${r.dejaFait ? ' ; RIEN À ÉCRIRE' : ''}) → --attendu=${r.lignes}`); return { ...r, plan, garde: g }; }
    log(`\n   ${r.dejaFait ? '↩️ rien à écrire (idempotent)' : `✅ écrit : ${r.lignes} ligne(s)`} · relu : ${r.relu.poses} portent leur numeroFiche (attendu ${plan.pose.length})`);
    if (!r.dejaFait && r.relu.poses !== plan.pose.length) { process.exitCode = 1; log('🔴 DIFFÉRENT DE CE QUI DEVAIT ÊTRE ÉCRIT'); }
    return { ...r, plan, garde: g };
}

module.exports = { executer, appliquer, restaurer, lireLignes, gardeSimulee, AUTORISES, LISTE_FERMEE };

if (require.main === module) {
    const argv = process.argv.slice(2);
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --attendu=<N>, --sauvegarde=<f>.json, --restaurer=<f>.json, --rapport=<f>.json, --produits=<id,id,…>`); process.exit(2); }
    const val = n => argv.find(x => x.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = argv.includes('--ecrire');
    const attendu = val('attendu') !== undefined ? Number(val('attendu')) : undefined;
    if (ecrire && attendu === undefined) { console.error('❌ --ecrire exige --attendu=<N> : rien n\'est écrit'); process.exit(2); }
    if (ecrire && !val('restaurer') && !val('sauvegarde')) { console.error('❌ --ecrire exige --sauvegarde=<f>.json (les valeurs d\'avant) : rien n\'est écrit'); process.exit(2); }
    (async () => {
        const dotenv = require('dotenv');
        dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
        if (!process.env.MONGODB_CARTES_URI) dotenv.config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env', quiet: true });
        const garde = () => require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid);
        if (ecrire) garde();   // refusé hors lot-additif.js AVANT toute connexion
        const j = JSON.parse(fs.readFileSync(LISTE_FERMEE, 'utf8'));
        if (!Array.isArray(j.produits) || !j.produits.length) throw new Error(`${LISTE_FERMEE} : aucun produit — une source vide ne prouve rien`);
        const filtre = val('produits') ? val('produits').split(',').map(Number) : null;
        let cartesDb, fermer;
        if (ecrire) {
            const o = await require('./collecte-cartes/garde').ouvrirConnexions({ production: false, buckets: [] });
            cartesDb = o.cartes.db; fermer = o.fermer;
        } else {
            if (!process.env.MONGODB_CARTES_LECTURE_URI) throw new Error('MONGODB_CARTES_LECTURE_URI obligatoire pour la simulation (lecture seule)');
            const { MongoClient } = require('mongodb');
            const c = new MongoClient(process.env.MONGODB_CARTES_LECTURE_URI); await c.connect();
            cartesDb = c.db('cartes'); fermer = () => c.close();
        }
        try { await executer({ cartesDb, produits: j.produits, produitsFiltre: filtre, ecrire, attendu, sauvegarde: val('sauvegarde'), restaurer: val('restaurer'), rapport: val('rapport') || null, garde }); }
        finally { await fermer(); }
    })().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
}
