// METAL — ÉTAPE 2 : ce que les candidats SERVENT aujourd'hui. LECTURE SEULE (base `cartes` par l'utilisateur de lecture), règle du site IMPORTÉE (exporter-donnees-logos-site.regleDuSite).
// node metal-sert.js   -> couverture/S7/METAL/sert.json
// Pour chaque candidat de planche : a-t-il une ligne `cartes_produits` (fiche) ? la fiche du site le range-t-elle ? quel visuel la règle du site lui sert-elle (du set, substitut, autre tirage) ?
// Et ce visuel est-il celui que sert son frère normal (même cleR2) — le scan de la carte normale pour une carte en métal : « sert un scan faux ».
'use strict';
const fs = require('fs');
const path = require('path');
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const X = require('./exporter-donnees-logos-site');
const { RACINE_METAL } = require('./metal-reperage');
const { retenuPourPlanche } = require('./metal-planches');
const LECTURE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\scratch\\lecture.js';
const RACINE_MAIN = 'C:\\Users\\Yung\\Desktop\\pokemon-proxy';   // le dépôt voisin du site se trouve par rapport à lui

/** Pur : le visuel que la règle du site sert à UN produit d'un set, ou null. `ctx` = { regle, set, ficheDe, cartes (Map id -> carte), setsBase, ligne }. */
function visuelServi({ regle, set, ficheDe, cartes, setsBase, ligne }) {
    const fiche = ficheDe.get(ligne.idProduct);
    if (!fiche) return { fiche: null, visuel: null, voie: null };
    const c = cartes.get(ligne.carteId);
    const admis = m => regle.visuelAdmisPourLaRegion(m, set.tirage ?? set.region);
    let im = X.visuelDuProduit(c?.images, set._id, fiche.numero, { admis, normaliser: regle.normaliserNumero }), voie = 'du-set';
    const admisDuSet = (c?.images || []).some(i => i?.set === set._id && i.cleR2 && admis(i));
    if (!im && ligne.visuelSubstitut?.cleR2) { im = ligne.visuelSubstitut; voie = 'substitut'; }
    if (!im && !admisDuSet) { const a = X.visuelAutreTirage(c?.images, set, setsBase); if (a) { im = a; voie = 'autre-tirage'; } }
    return { fiche: { carteId: fiche.carteId, numero: fiche.numero }, visuel: im ? { cleR2: im.cleR2, source: im.source ?? null, set: im.set ?? set._id, numero: im.numero ?? null, langue: im.langue ?? null } : null, voie };
}

async function main() {
    const { candidats } = JSON.parse(fs.readFileSync(path.join(RACINE_METAL, 'candidats.json'), 'utf8'));
    const liste = candidats.filter(retenuPourPlanche);
    const ids = [...new Set(liste.flatMap(c => [c.idProduct, ...c.freres]))];
    const { ouvrir } = require(LECTURE); const { client, db } = await ouvrir();
    const regle = await X.regleDuSite(RACINE_MAIN);
    const lignes = await db.collection('cartes_produits').find({ idProduct: { $in: ids } }).toArray();
    const parProduit = new Map(); for (const l of lignes) parProduit.set(l.idProduct, [...(parProduit.get(l.idProduct) || []), l]);
    const setsBase = new Map((await db.collection('sets').find({}, { projection: { idExpansion: 1, nomAffichage: 1, tirage: 1, region: 1, code: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
    const setDe = new Map(); for (const s of setsBase.values()) for (const e of [].concat(s.idExpansion ?? [])) { if (!setDe.has(e)) setDe.set(e, []); setDe.get(e).push(s); }
    const cache = new Map();   // slugSet -> { ficheDe, cartes }
    async function etatDuSet(s) {
        if (cache.has(s._id)) return cache.get(s._id);
        const exps = [].concat(s.idExpansion ?? []);
        const lig = await db.collection('cartes_produits').find({ $or: [{ slugSet: s._id }, { idExpansion: { $in: exps } }] }).toArray();
        const docs = (await db.collection('cartes').find({ sets: s._id }).toArray()).filter(d => typeof d.nomEn === 'string' && d.nomEn);
        const idsDocs = new Set(docs.map(d => d._id));
        const { fiche } = X.fichesDesProduits(regle, s, docs, lig.filter(l => idsDocs.has(l.carteId) && exps.includes(l.idExpansion)));
        const cartesLig = new Map((await db.collection('cartes').find({ _id: { $in: [...new Set(lig.map(l => l.carteId))] } }).toArray()).map(c => [c._id, c]));
        const e = { ficheDe: fiche, cartes: cartesLig }; cache.set(s._id, e); return e;
    }
    async function servi(idProduct) {
        const ls = parProduit.get(idProduct) || [];
        const sorties = [];
        for (const l of ls) {
            const s = setsBase.get(l.slugSet) || (setDe.get(l.idExpansion) || [])[0];
            if (!s) { sorties.push({ ligne: l._id, set: l.slugSet ?? null, fiche: null, visuel: null, voie: null, motif: 'set-introuvable' }); continue; }
            const e = await etatDuSet(s);
            sorties.push({ ligne: l._id, carteId: l.carteId, set: s._id, ...visuelServi({ regle, set: s, ficheDe: e.ficheDe, cartes: e.cartes, setsBase, ligne: l }) });
        }
        return sorties;
    }
    const sortie = [], parEtat = {};
    for (const c of liste) {
        const lui = await servi(c.idProduct), freres = [];
        for (const f of c.freres) freres.push({ idProduct: f, servi: await servi(f) });
        const visuelsFreres = new Set(freres.flatMap(f => f.servi.map(s => s.visuel?.cleR2).filter(Boolean)));
        const cartesFreres = new Set(freres.flatMap(f => f.servi.map(s => s.carteId).filter(Boolean)));
        let etat;
        if (!lui.length) etat = 'sans-ligne';
        else if (!lui.some(s => s.fiche)) etat = 'ligne-sans-fiche-du-site';
        else if (!lui.some(s => s.visuel)) etat = 'fiche-sans-visuel';
        else if (lui.some(s => s.visuel && visuelsFreres.has(s.visuel.cleR2))) etat = 'SERT-LE-SCAN-DU-FRERE';
        else etat = 'sert-un-autre-visuel';
        parEtat[etat] = (parEtat[etat] || 0) + 1;
        sortie.push({ idProduct: c.idProduct, name: c.name, verdict: c.verdict, expansion: c.expansion, etat, memeCarteQueUnFrere: lui.some(s => s.carteId && cartesFreres.has(s.carteId)), lignes: lui, freres });
    }
    await client.close();
    const out = { date: '2026-10-18', candidats: liste.length, parEtat, sert: sortie };
    fs.writeFileSync(autoriser(path.join(RACINE_METAL, 'sert.json'), [RACINE_METAL]), JSON.stringify(out, null, 1));
    console.log(JSON.stringify({ candidats: liste.length, parEtat }));
    for (const s of sortie.filter(x => x.etat !== 'sans-ligne').slice(0, 40)) console.log(s.verdict, s.idProduct, s.name, s.etat, s.memeCarteQueUnFrere);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { visuelServi };
