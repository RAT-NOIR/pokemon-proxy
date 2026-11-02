'use strict';
// LECTURE SEULE : les 10 produits STAFF SVP (761120…761130) — codes_set, numeros_cartes (slug), cartes_produits — et le verdict de `sansTotalAdmis` sur les données réelles.
const path = require('path');
require('dotenv').config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env' });
const { ouvrirConnexions } = require('../collecte-cartes/garde');
const PV = require('../collecte-cartes/preuves');
const IDS = [761120, 761121, 761123, 761124, 761125, 761126, 761127, 761128, 761129, 761130];
const NUM = { 761120: '006', 761121: '007', 761123: '019', 761124: '020', 761125: '021', 761126: '022', 761127: '036', 761128: '037', 761129: '038', 761130: '039' };
(async () => {
    const cx = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
    try {
        const prod = cx.prod.db, cartes = cx.cartes.db;
        const numeros = await prod.collection('numeros_cartes').find({ idProduct: { $in: IDS } }, { projection: { _id: 0, idProduct: 1, numero: 1, slug: 1, slugSet: 1, idExpansion: 1, codeSet: 1 } }).toArray();
        const lignes = await cartes.collection('cartes_produits').find({ idProduct: { $in: IDS } }, { projection: { _id: 0, idProduct: 1, slugSet: 1, slug: 1, numeroFiche: 1, idExpansion: 1 } }).toArray();
        const idExp = [...new Set([...numeros, ...lignes].map(x => x.idExpansion).filter(Number.isInteger))];
        const codes = await prod.collection('codes_set').find({ idExpansion: { $in: idExp } }, { projection: { _id: 0, idExpansion: 1, codeSet: 1 } }).toArray();
        console.log('numeros_cartes', numeros.length, 'cartes_produits', lignes.length, 'codes_set', JSON.stringify(codes));
        let admis = 0;
        for (const id of IDS) {
            const n = numeros.find(x => x.idProduct === id), l = lignes.find(x => x.idProduct === id);
            const codeSet = codes.find(c => c.idExpansion === (l?.idExpansion ?? n?.idExpansion))?.codeSet ?? null;
            const numero = l?.numeroFiche ?? n?.numero ?? null;
            const slug = l?.slug ?? n?.slug ?? null;
            const lu = { numero: NUM[id], codeSet: 'SVP' };
            const sans = PV.sansTotalAdmis(lu, { slugSet: l?.slugSet, slug, codeSet: null, numero }, numero);
            const avec = PV.sansTotalAdmis(lu, { slugSet: l?.slugSet, slug, codeSet, numero }, numero);
            if (sans && avec) admis++;
            console.log(id, JSON.stringify({ slugSet: l?.slugSet, numeroFiche: l?.numeroFiche, numeroNC: n?.numero, slug, slugNC: n?.slug, codeSet }), 'admis sans codeSet:', sans, 'avec codeSet:', avec);
        }
        console.log('ADMIS', admis, '/', IDS.length);
    } finally { await cx.fermer(); }
})().catch(e => { console.error(String(e.stack || e.message).replace(/mongodb\S+/g, '<uri>')); process.exit(1); });
