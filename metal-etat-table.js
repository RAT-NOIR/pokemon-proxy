// METAL — état en base (LECTURE SEULE, utilisateur de lecture) de chaque produit de la table fermée : ligne cartes_produits, liens.idProduct sur une carte, visuel servi par la règle du site.
// node metal-etat-table.js
'use strict';
const { PRODUITS_MATIERE_SPECIALE } = require('./collecte-cartes/matiere-speciale');
const X = require('./exporter-donnees-logos-site');
const { visuelServi } = require('./metal-sert');
const LECTURE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\scratch\\lecture.js';

(async () => {
    const ids = Object.keys(PRODUITS_MATIERE_SPECIALE).map(Number);
    const { ouvrir } = require(LECTURE); const { client, db } = await ouvrir();
    const lignes = await db.collection('cartes_produits').find({ idProduct: { $in: ids } }).toArray();
    const cartesLiens = await db.collection('cartes').find({ 'liens.idProduct': { $in: ids } }, { projection: { nomEn: 1, 'liens.idProduct': 1 } }).toArray();
    const partages = await db.collection('cartes').find({ 'images.produitsPartages': { $in: ids } }, { projection: { nomEn: 1, 'images.set': 1, 'images.cleR2': 1, 'images.produitsPartages': 1 } }).toArray();
    const regle = await X.regleDuSite('C:\\Users\\Yung\\Desktop\\pokemon-proxy');
    const setsBase = new Map((await db.collection('sets').find({}, { projection: { idExpansion: 1, nomAffichage: 1, tirage: 1, region: 1, code: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
    const sortie = [];
    for (const id of ids) {
        const ls = lignes.filter(l => l.idProduct === id);
        const liens = cartesLiens.filter(c => (c.liens?.idProduct || []).includes(id)).map(c => c._id);
        const pars = partages.filter(c => (c.images || []).some(e => (e.produitsPartages || []).includes(id))).map(c => c._id);
        const servis = [];
        for (const l of ls) {
            const s = setsBase.get(l.slugSet); if (!s) { servis.push({ ligne: l._id, motif: 'set introuvable' }); continue; }
            const exps = [].concat(s.idExpansion ?? []);
            const lig = await db.collection('cartes_produits').find({ $or: [{ slugSet: s._id }, { idExpansion: { $in: exps } }] }).toArray();
            const docs = (await db.collection('cartes').find({ sets: s._id }).toArray()).filter(d => typeof d.nomEn === 'string' && d.nomEn);
            const ids2 = new Set(docs.map(d => d._id));
            const { fiche } = X.fichesDesProduits(regle, s, docs, lig.filter(x => ids2.has(x.carteId) && exps.includes(x.idExpansion)));
            const cartes = new Map(docs.map(d => [d._id, d]));
            servis.push({ ligne: l._id, ...visuelServi({ regle, set: s, ficheDe: fiche, cartes, setsBase, ligne: l }) });
        }
        sortie.push({ idProduct: id, nom: PRODUITS_MATIERE_SPECIALE[id].nom, matiere: PRODUITS_MATIERE_SPECIALE[id].matiere, lignes: ls.map(l => l._id), liensIdProduct: liens, produitsPartagesSurCartes: pars, servis });
    }
    await client.close();
    for (const s of sortie) console.log(JSON.stringify(s));
    console.log(`à détacher par le lot de retrait : ${sortie.reduce((n, s) => n + s.lignes.length, 0)} ligne(s) ; liens.idProduct à nettoyer : ${sortie.reduce((n, s) => n + s.liensIdProduct.length, 0)}`);
})().catch(e => { console.error(e); process.exit(1); });
