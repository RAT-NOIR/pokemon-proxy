// ============================================================
// PARTAGES-SEPARES (2026-10-18) — retirer `produitsPartages` des paires Staff / Jumbo désormais SÉPARÉES par la variante
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-18) : « Les 61 marques produitsPartages : oui, retire-les SEULEMENT sur les paires désormais séparées par la variante (staff ou jumbo). Les 3 paires non séparables
// gardent leur marque. Ensuite, signale-le dans DEMANDE-API-VISUELS.md : l'API remesure le banc et doit retrouver 0 faux. Sinon, retour en arrière. »
// Pourquoi : l'entrée `SV-Black-Star-Promos` d'une carte portait la liste de la paire SV-P ; les produits d'autres sets servis par la même carte (Thai-Promos…) n'y figuraient pas et l'API jugeait l'entrée incohérente.
//
// LE GESTE : `$unset` de `produitsPartages` SEUL, sur l'entrée `cartes.images` ET sur son document `images`. `partageeTamponNonSepare: false` et `tamponNonRepresente` RESTENT (décision du 17/10 : notre visuel reste
// l'image sans étiquette, avec tamponNonRepresente). Les Prize Packs (`partageeHoloNonHolo: true`) et les 3 paires non séparables (`partageeTamponNonSepare: true`) ne sont JAMAIS des cibles.
//
// ÉCRIT PAR CE QU'IL AUTORISE : une entrée n'est une cible que si TOUT est prouvé (marquage « séparée » exact, deux idProduct, leurs lignes de la même carte portent la variante attendue, le document
// correspondant est unique et porte le même marquage). Tout le reste est LAISSÉ et listé avec sa raison. Aucune requête réseau.
const fs = require('fs');
const path = require('path');
const COMPTEURS = require('./garde-lot');

const TYPE_DU_LIBELLE = Object.freeze({ Staff: 'staff', Jumbo: 'jumbo' });
const memesIds = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();

/** Les variantes des lignes d'un produit pour UNE carte : 'staff' | 'jumbo' | 'normale' si toutes les lignes (au moins une) la portent, sinon un motif. */
function varianteDuProduit(lignes, carteId, id) {
    const ls = lignes.filter(l => l.idProduct === id && l.carteId === carteId);
    if (!ls.length) return { motif: 'ligne-absente' };
    const vs = [...new Set(ls.map(l => l.variante ?? null))];
    if (vs.length !== 1 || vs[0] === null) return { motif: 'variante-absente-ou-mixte' };
    return { variante: vs[0] };
}

/**
 * LE PLAN : les entrées à dégager (avec leur document) et les entrées laissées (avec leur raison). Rien n'est écrit.
 * @returns {Promise<{cibles: object[], laissees: object[], comptes: object}>}
 */
async function construirePlan({ cartesDb }) {
    const cartes = await cartesDb.collection('cartes').find({ 'images.produitsPartages': { $exists: true } }, { projection: { images: 1, nomEn: 1 } }).toArray();
    const brutes = [];
    let holo = 0;
    for (const c of cartes) for (const e of c.images || []) {
        if (!e || e.produitsPartages === undefined) continue;
        if (e.partageeHoloNonHolo === true) { holo++; continue; }
        brutes.push({ c, e });
    }
    const ids = [...new Set(brutes.flatMap(({ e }) => Array.isArray(e.produitsPartages) ? e.produitsPartages : []))];
    const lignes = ids.length ? await cartesDb.collection('cartes_produits').find({ idProduct: { $in: ids } }).toArray() : [];
    const cles = [...new Set(brutes.map(({ e }) => e.cleR2).filter(Boolean))];
    const docs = cles.length ? await cartesDb.collection('images').find({ cleR2: { $in: cles } }).toArray() : [];
    const cibles = [], laissees = [];
    for (const { c, e } of brutes) {
        const base = { carteId: c._id, nom: c.nomEn ?? null, set: e.set, cleR2: e.cleR2, numero: e.numero ?? null, produitsPartages: e.produitsPartages, tamponNonRepresente: e.tamponNonRepresente ?? null };
        const non = motif => laissees.push({ ...base, motif });
        if (e.partageeTamponNonSepare === true) { non('paire-non-separable'); continue; }
        if (e.partageeTamponNonSepare !== false) { non('pas-une-paire-tampon'); continue; }
        const type = TYPE_DU_LIBELLE[e.tamponNonRepresente];
        if (!type) { non('tampon-hors-staff-jumbo'); continue; }
        if (!Array.isArray(e.produitsPartages) || e.produitsPartages.length !== 2 || e.produitsPartages[0] === e.produitsPartages[1]) { non('produitsPartages-pas-deux'); continue; }
        if ((c.images || []).filter(x => x && x.set === e.set && x.cleR2 === e.cleR2).length !== 1) { non('entree-ambigue'); continue; }
        const vs = e.produitsPartages.map(id => varianteDuProduit(lignes, c._id, id));
        const defaut = vs.find(v => v.motif);
        if (defaut) { non(defaut.motif); continue; }
        const labels = vs.map(v => v.variante).sort().join('+');
        if (labels !== ['normale', type].sort().join('+')) { non('variantes-inattendues'); continue; }
        const memeCle = docs.filter(d => d.cleR2 === e.cleR2 && d.carteId === c._id && d.set === e.set);
        if (!memeCle.length) { non('document-absent'); continue; }
        if (memeCle.length > 1) { non('document-ambigu'); continue; }
        const d = memeCle[0];
        if (!memesIds(d.produitsPartages, e.produitsPartages) || d.partageeTamponNonSepare !== false || d.tamponNonRepresente !== e.tamponNonRepresente) { non('document-different'); continue; }
        cibles.push({ ...base, type, idDoc: d._id });
    }
    cibles.sort((x, y) => String(x.set).localeCompare(String(y.set)) || String(x.numero).localeCompare(String(y.numero)) || x.carteId - y.carteId);
    const parMotif = {};
    for (const l of laissees) parMotif[l.motif] = (parMotif[l.motif] || 0) + 1;
    const parType = {};
    for (const t of cibles) parType[t.type] = (parType[t.type] || 0) + 1;
    return { cibles, laissees, comptes: { entrees: cibles.length, documents: cibles.length, laissees: laissees.length, parMotif, parType, holoIgnorees: holo } };
}

const verifierAttendu = (attendu, n, quoi) => {
    if (attendu !== undefined && attendu !== null && attendu !== n) throw new Error(`--attendu=${attendu} mais ${n} ${quoi} : rien n'est écrit`);
};

/** Combien de cibles ont ENCORE leur `produitsPartages` (entrée, document) : 0/0 après l'écriture, N/N après la restauration. */
async function compterPresence(cartesDb, cibles) {
    let entrees = 0, documents = 0;
    for (const t of cibles) {
        const c = await cartesDb.collection('cartes').findOne({ _id: t.carteId });
        const e = (c?.images || []).find(x => x && x.set === t.set && x.cleR2 === t.cleR2);
        if (e && e.produitsPartages !== undefined) entrees++;
        const d = await cartesDb.collection('images').findOne({ _id: t.idDoc });
        if (d && d.produitsPartages !== undefined) documents++;
    }
    return { entrees, documents };
}

/**
 * Écrit (ou simule). `attendu` est OBLIGATOIRE à l'écriture et refuse AVANT toute écriture ; `sauvegarde` (chemin d'un .json) est écrit AVANT la première écriture : les valeurs d'avant.
 * Chaque update reprend la condition qui a fait la cible (filtre conditionnel) ; le compte réel est relu après.
 */
async function appliquer(cartesDb, plan, { ecrire = false, attendu, sauvegarde } = {}) {
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> (le nombre d\'entrées lu à l\'essai à blanc) : rien n\'est écrit');
    verifierAttendu(attendu, plan.cibles.length, 'entrée(s) cible(s)');
    const r = { entrees: plan.cibles.length, documents: plan.cibles.length, dejaFait: !plan.cibles.length };
    if (!ecrire) return r;
    if (!plan.cibles.length) return { ...r, relu: { entrees: 0, documents: 0 } };
    if (!sauvegarde) throw new Error('--ecrire exige une sauvegarde des valeurs d\'avant (--sauvegarde=<f>.json) : rien n\'est écrit');
    fs.mkdirSync(path.dirname(path.resolve(sauvegarde)), { recursive: true });
    fs.writeFileSync(sauvegarde, JSON.stringify({ le: new Date().toISOString(), quoi: 'valeurs d\'avant du $unset de produitsPartages (retirer-partages-separes.js)', cibles: plan.cibles.map(t => ({ carteId: t.carteId, set: t.set, cleR2: t.cleR2, idDoc: t.idDoc, produitsPartages: t.produitsPartages, tamponNonRepresente: t.tamponNonRepresente })) }, null, 1));
    for (const t of plan.cibles) {
        const res = await cartesDb.collection('cartes').updateOne({ _id: t.carteId }, { $unset: { 'images.$[e].produitsPartages': '' } },
            { arrayFilters: [{ 'e.set': t.set, 'e.cleR2': t.cleR2, 'e.partageeTamponNonSepare': false, 'e.tamponNonRepresente': t.tamponNonRepresente, 'e.produitsPartages': t.produitsPartages }] });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`entrée introuvable ou inchangée : carte ${t.carteId}, ${t.set}, ${t.cleR2} — arrêt (rejouer : idempotent ; --restaurer remet l'avant)`);
        const rd = await cartesDb.collection('images').updateOne({ _id: t.idDoc, partageeTamponNonSepare: false, tamponNonRepresente: t.tamponNonRepresente, produitsPartages: t.produitsPartages }, { $unset: { produitsPartages: '' } });
        if (!rd.matchedCount || !rd.modifiedCount) throw new Error(`document images introuvable ou inchangé : ${t.idDoc} — arrêt (rejouer : idempotent ; --restaurer remet l'avant)`);
    }
    const presence = await compterPresence(cartesDb, plan.cibles);
    return { ...r, relu: presence };
}

/** Remet exactement les valeurs du fichier de sauvegarde (`$set`), seulement là où le champ est absent. `attendu` obligatoire à l'écriture. */
async function restaurer(cartesDb, fichier, { ecrire = false, attendu } = {}) {
    const cibles = JSON.parse(fs.readFileSync(fichier, 'utf8')).cibles;
    if (!Array.isArray(cibles) || !cibles.length) throw new Error(`${fichier} : aucune cible à restaurer`);
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--restaurer --ecrire exige --attendu=<N> : rien n\'est écrit');
    verifierAttendu(attendu, cibles.length, 'entrée(s) dans la sauvegarde');
    const r = { entrees: cibles.length, documents: cibles.length };
    if (!ecrire) return r;
    for (const t of cibles) {
        const res = await cartesDb.collection('cartes').updateOne({ _id: t.carteId }, { $set: { 'images.$[e].produitsPartages': t.produitsPartages } },
            { arrayFilters: [{ 'e.set': t.set, 'e.cleR2': t.cleR2, 'e.partageeTamponNonSepare': false, 'e.produitsPartages': { $exists: false } }] });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`entrée introuvable ou déjà restaurée : carte ${t.carteId}, ${t.set}, ${t.cleR2} — arrêt`);
        const rd = await cartesDb.collection('images').updateOne({ _id: t.idDoc, produitsPartages: { $exists: false } }, { $set: { produitsPartages: t.produitsPartages } });
        if (!rd.matchedCount || !rd.modifiedCount) throw new Error(`document images introuvable ou déjà restauré : ${t.idDoc} — arrêt`);
    }
    return { ...r, relu: await compterPresence(cartesDb, cibles.map(t => ({ ...t }))) };
}

/** L'annonce de lot, par la fonction de la garde (compterEtat + comparer) : l'état des cartes touchées avant / après le retrait simulé. {} = aucune baisse. */
async function annonceDePlan(cartesDb, plan) {
    const ids = [...new Set(plan.cibles.map(t => t.carteId))];
    const avant = ids.length ? await cartesDb.collection('cartes').find({ _id: { $in: ids } }).toArray() : [];
    const apres = structuredClone(avant);
    for (const t of plan.cibles) {
        const e = (apres.find(x => x._id === t.carteId)?.images || []).find(x => x && x.set === t.set && x.cleR2 === t.cleR2);
        if (!e) throw new Error(`annonce : entrée introuvable, carte ${t.carteId}, ${t.cleR2}`);
        delete e.produitsPartages;
    }
    const cmp = COMPTEURS.comparer(COMPTEURS.compterEtat({ cartes: avant }), COMPTEURS.compterEtat({ cartes: apres }));
    const annonces = {};
    for (const b of cmp.baisses) if (b.compteur in COMPTEURS.COMPTEURS) annonces[b.cle] = b.baisse;
    COMPTEURS.validerAnnonces(annonces);
    return { annonces, baissesNonAutorisees: cmp.nonAutorisees.length };
}

module.exports = { construirePlan, appliquer, restaurer, annonceDePlan, compterPresence, TYPE_DU_LIBELLE };
