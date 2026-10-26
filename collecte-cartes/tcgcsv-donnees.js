// ============================================================
// LES DONNÉES CARDMARKET DE LA JOINTURE « tcs » (T4) — lecture seule, assemblage pur
// ============================================================
// La jointure lit, pour chaque produit Cardmarket : son nom de catalogue, son numéro (numeros_cartes), son slug, son expansion, la ou les lignes de fiche (cartes_produits) et la carte (nom, impressions numérotées).
// `assemblerCm` est PUR (testé sur de petites fixtures) ; `lireCmDepuisBase` ne fait que des LECTURES (la base `cartes` par la connexion de lecture seule, la production par `lectureSeule`). Aucune écriture.
'use strict';
const JT = require('./tcgcsv-jointure');

/**
 * @param {{sets: object[], cp: object[], cartes: object[], nc: object[], cat: object[]}} d  `cat` : catalogue_produits ; `nc` : numeros_cartes ; `cp` : cartes_produits ; `cartes` : nom + impressions (+ images)
 * @returns {{expansions: Map<number, object>, produits: Map<number, object>, denominateurs: object}}
 */
function assemblerCm({ sets, cp, cartes, nc, cat }) {
    if (!nc?.length || !cat?.length) throw new Error(`assemblerCm : numeros_cartes ${nc?.length ?? 0} / catalogue ${cat?.length ?? 0} — une population vide est un instrument cassé, pas une absence (§41)`);
    const tirageDe = new Map((sets || []).map(s => [s._id, s.tirage ?? s.region ?? null]));
    const nomDe = new Map(cat.map(c => [c.idProduct, c]));
    const carteDe = new Map((cartes || []).map(c => [c._id, c]));
    const lignesDe = new Map();
    for (const l of cp || []) (lignesDe.get(l.idProduct) || lignesDe.set(l.idProduct, []).get(l.idProduct)).push(l);
    const expansions = new Map(), produits = new Map();
    let sansCatalogue = 0;
    for (const x of nc) {
        const c = nomDe.get(x.idProduct);
        if (!c) { sansCatalogue++; continue; }
        const lu = JT.lireCm({ idProduct: x.idProduct, name: c.name, numero: x.numero, slug: x.slug, slugSet: x.slugSet, codeSet: x.codeSet, idExpansion: x.idExpansion });
        const lignes = (lignesDe.get(x.idProduct) || []).map(l => ({ carteId: l.carteId, slugSet: l.slugSet, numeroFiche: l.numeroFiche ?? null }));
        const carte = lignes.length === 1 ? carteDe.get(lignes[0].carteId) ?? null : null;
        const p = { idProduct: x.idProduct, name: c.name, slug: x.slug ?? null, slugSet: x.slugSet ?? null, codeSet: x.codeSet ?? null, numero: x.numero ?? null, idExpansion: x.idExpansion, lu, lignes,
            carteNom: carte?.nomEn ?? null, fiche: carte ? { nomEn: carte.nomEn, impressions: carte.impressions || [] } : null, nImages: carte ? (carte.images || []).length : 0, images: carte ? (carte.images || []) : [] };
        produits.set(x.idProduct, p);
        const e = expansions.get(x.idExpansion) || expansions.set(x.idExpansion, { idExpansion: x.idExpansion, slugSet: x.slugSet ?? null, codeSet: x.codeSet ?? null, tirage: tirageDe.get(x.slugSet) ?? null, produits: [] }).get(x.idExpansion);
        e.produits.push(p);
    }
    const denominateurs = { numeros_cartes: nc.length, catalogue: cat.length, produits: produits.size, sansCatalogue, expansions: expansions.size, cartes_produits: (cp || []).length, produitsAvecLigne: [...produits.values()].filter(p => p.lignes.length).length,
        expansionsSansTirage: [...expansions.values()].filter(e => !e.tirage).length };
    return { expansions, produits, denominateurs };
}
/** Les expansions au format de `construireTable` : { idExpansion, slugSet, codeSet, tirage, produits: [lireCm] }. */
const expansionsPourTable = cm => [...cm.expansions.values()].map(e => ({ idExpansion: e.idExpansion, slugSet: e.slugSet, codeSet: e.codeSet, tirage: e.tirage, produits: e.produits.map(p => p.lu) }));

/** Lecture seule : les six collections d'un coup. `lecture` : { cartes: { db } } (ouvrirLecture) ; `prodDb` : la production en lecture seule (garde.ouvrirConnexions({ lectureSeule: true }).prod.db). */
async function lireCmDepuisBase(lecture, prodDb) {
    const db = lecture.cartes.db;
    const sets = await db.collection('sets').find({}, { projection: { tirage: 1, region: 1 } }).toArray();
    const cp = await db.collection('cartes_produits').find({}, { projection: { _id: 0, idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1 } }).toArray();
    const ids = [...new Set(cp.map(x => x.carteId))], cartes = [];
    for (let i = 0; i < ids.length; i += 2000) cartes.push(...await db.collection('cartes').find({ _id: { $in: ids.slice(i, i + 2000) } }).project({ nomEn: 1, impressions: 1, 'images.source': 1, 'images.set': 1, 'images.numero': 1 }).toArray());
    const nc = await prodDb.collection('numeros_cartes').find({}, { projection: { _id: 0, idProduct: 1, slug: 1, slugSet: 1, codeSet: 1, numero: 1, idExpansion: 1 } }).toArray();
    const cat = await prodDb.collection('catalogue_produits').find({}, { projection: { _id: 0, idProduct: 1, name: 1 } }).toArray();
    return { sets, cp, cartes, nc, cat };
}

module.exports = { assemblerCm, expansionsPourTable, lireCmDepuisBase };
