'use strict';
// ============================================================
// IMAGE DU PARENT — lot EEVEE (décision 4 du testeur, 2026-10-13), à LISTE FERMÉE
// ============================================================
// « Eevee x30C116 : OUI, il reçoit le scan du parent, marqué « image du parent » (champ explicite). Jamais compté comme preuve visuelle propre,
//   exclu du banc et de l'apprentissage visuel. »
//
// Le mécanisme est celui du VISUEL DE SUBSTITUTION (CONTRAT-SITE.md, §66) : `cartes_produits.visuelSubstitut` sur la SEULE ligne de la liste.
// Ni `cartes.images`, ni `imagesRefusees` de la ligne de table x30C ne bougent : aucun lecteur existant ne voit ce champ sans l'avoir demandé
// par son nom, et l'index de reconnaissance ne l'utilise jamais. Le champ explicite est `visuelSubstitut.imageDuParent: true`.
//
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (CLAUDE.md, en tête des règles de sécurité) : une écriture n'a lieu que si TOUT ceci est vrai —
// la ligne existe ET porte l'_id, le carteId, l'idProduct et le slugSet de la liste ; elle n'a AUCUN `visuelSubstitut` (jamais réécrit) ;
// la carte existe ; elle porte UNE SEULE entrée de fichier dans le set PARENT au numéro de la liste (`cleNumero`) ; la règle du site
// l'admet pour un tirage intl. Tout le reste est un refus, avec sa raison.
// Pure par rapport à la base : `db` est injecté (une collection = findOne / updateOne / countDocuments), la règle du site aussi.
const { cleNumero } = require('./jointure');

const LOT = 'eevee-image-du-parent-2026-10-13';
const DECISION = '2026-10-13, testeur : « Eevee x30C116 : OUI, il reçoit le scan du parent, marqué « image du parent » (champ explicite). Jamais compté comme preuve visuelle propre, exclu du banc et de l\'apprentissage visuel. »';

const ENTREES = Object.freeze([Object.freeze({
    _id: '358473|909374', carteId: 358473, idProduct: 909374, slugSet: '30th-Celebration-Additionals',
    setParent: '30th-Celebration', numero: '116',
    mention: 'Image du parent (30th Celebration n°116) : ce produit est le holo de coffret'
})]);

const verifierRegle = regle => { if (typeof regle !== 'function') throw new Error('règle du site absente (visuelAdmisPourLaRegion) — la décision s\'arrête (jamais un repli)'); };

/** Décide, pour une entrée, de ce qu'on pose. Pure. @returns {{ ok:true, visuelSubstitut:object } | { ok:false, raison:string }} */
function decider(entree, ligne, carte, regle, { maintenant = new Date() } = {}) {
    verifierRegle(regle);
    if (!ligne) return { ok: false, raison: `ligne absente (${entree._id})` };
    for (const k of ['carteId', 'idProduct', 'slugSet']) if (ligne[k] !== entree[k]) return { ok: false, raison: `la ligne n'est pas celle de la liste : ${k} ${JSON.stringify(ligne[k])} au lieu de ${JSON.stringify(entree[k])}` };
    if (ligne.visuelSubstitut !== undefined) return { ok: false, raison: `visuelSubstitut déjà posé (${ligne.visuelSubstitut?.lot ?? 'sans lot'}) — jamais réécrit` };
    if (!carte) return { ok: false, raison: `carte absente (${entree.carteId})` };
    const memeNumero = (carte.images || []).filter(i => i && i.set === entree.setParent && i.numero != null && cleNumero(i.numero) === cleNumero(entree.numero) && typeof i.cleR2 === 'string' && i.cleR2);
    const fichiers = [...new Map(memeNumero.map(i => [i.cleR2, i])).values()];
    if (!fichiers.length) return { ok: false, raison: `image du parent absente (aucune entrée de ${entree.setParent} au n°${entree.numero} dans cartes.images de ${entree.carteId})` };
    if (fichiers.length > 1) return { ok: false, raison: `deux fichiers (ou plus) au n°${entree.numero} de ${entree.setParent} : ${fichiers.map(i => i.cleR2).join(' ; ')}` };
    const i = fichiers[0];
    if (!regle(i, 'intl')) return { ok: false, raison: `image refusée par la règle du site pour un tirage intl (${i.cleR2}, langue ${i.langue ?? 'inconnue'})` };
    return {
        ok: true,
        visuelSubstitut: {
            cleR2: i.cleR2, source: i.source ?? null, set: i.set, numero: i.numero ?? null, langue: i.langue ?? null, w: i.w ?? null, h: i.h ?? null,
            imageDuParent: true, mention: entree.mention,
            preuve: `image du parent : carte ${entree.carteId} dans ${i.set} n°${i.numero} (${i.cleR2}) ; la ligne ${entree._id} (${entree.slugSet}) est le holo de coffret, impression distincte`,
            lot: LOT, decision: DECISION, le: maintenant
        }
    };
}

/** Lit la base (lecture seule) et décide pour toute la liste. @returns {{ aPoser:{entree,ligneId,visuelSubstitut}[], refus:{entree,raison}[] }} */
async function simuler(db, regle, opts = {}) {
    verifierRegle(regle);
    const aPoser = [], refus = [];
    for (const entree of ENTREES) {
        const ligne = await db.collection('cartes_produits').findOne({ _id: entree._id });
        const carte = await db.collection('cartes').findOne({ _id: entree.carteId });
        const d = decider(entree, ligne, carte, regle, opts);
        if (d.ok) aPoser.push({ entree, ligneId: entree._id, visuelSubstitut: d.visuelSubstitut }); else refus.push({ entree, raison: d.raison });
    }
    return { aPoser, refus };
}

/** Écrit le plan. Le filtre REPREND la liste et la condition « rien de posé » : un état qui a bougé depuis la simulation ne matche pas. @returns {number} lignes posées */
async function poser(db, plan) {
    let n = 0;
    for (const x of plan.aPoser) {
        const e = x.entree;
        n += (await db.collection('cartes_produits').updateOne(
            { _id: e._id, carteId: e.carteId, idProduct: e.idProduct, slugSet: e.slugSet, visuelSubstitut: { $exists: false } },
            { $set: { visuelSubstitut: x.visuelSubstitut } })).modifiedCount;
    }
    return n;
}

/** Ce que le retrait enlèverait : SEULEMENT ce que ce lot a posé (même lot ET imageDuParent:true). */
async function simulerRetrait(db) {
    const aRetirer = [], refus = [];
    for (const entree of ENTREES) {
        const ligne = await db.collection('cartes_produits').findOne({ _id: entree._id });
        if (!ligne) { refus.push({ entree, raison: `ligne absente (${entree._id})` }); continue; }
        const v = ligne.visuelSubstitut;
        if (v === undefined) { refus.push({ entree, raison: 'rien à retirer : aucun visuelSubstitut' }); continue; }
        if (v?.lot !== LOT || v?.imageDuParent !== true) { refus.push({ entree, raison: `visuelSubstitut d'un autre lot (${v?.lot ?? 'sans lot'}, imageDuParent ${v?.imageDuParent ?? 'absent'}) — jamais retiré` }); continue; }
        aRetirer.push({ entree });
    }
    return { aRetirer, refus };
}

/** Retire ; le filtre reprend lot et imageDuParent au moment d'écrire. @returns {number} */
async function retirer(db, plan) {
    let n = 0;
    for (const x of plan.aRetirer) {
        n += (await db.collection('cartes_produits').updateOne(
            { _id: x.entree._id, 'visuelSubstitut.lot': LOT, 'visuelSubstitut.imageDuParent': true },
            { $unset: { visuelSubstitut: '' } })).modifiedCount;
    }
    return n;
}

module.exports = { LOT, DECISION, ENTREES, decider, simuler, poser, simulerRetrait, retirer };
