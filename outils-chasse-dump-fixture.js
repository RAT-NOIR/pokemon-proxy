// LECTURE SEULE. node -r dotenv/config outils-chasse-dump-fixture.js <CODE> : écrit fixtures/nom-seul/<CODE>.json = les VRAIS documents (cartes qui déclarent l'expansion, impressions réduites à celles
// du set ; produits de l'expansion ; lignes déjà posées) que lit poser-lignes-nom-seul.js. Aucune donnée inventée (consigne « pas de fixtures inventées »).
const fs = require('fs'), path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
const { ligne } = require('./collecte-cartes/table-sets');
(async () => {
    const code = process.argv[2], L = ligne(code); if (!L) throw new Error('ligne inconnue ' + code);
    const cx = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
    try {
        const TIRAGE = L.bulba.tirage || 'jp', noms = [].concat(L.bulba.expansion);
        const cartes = (await cx.cartes.db.collection('cartes').find({ impressions: { $elemMatch: { tirage: TIRAGE, expansion: { $in: noms } } } }, { projection: { nomEn: 1, impressions: 1, attaques: 1, sets: 1 } }).toArray())
            .map(c => ({ ...c, impressions: c.impressions.filter(i => i.tirage === TIRAGE && noms.includes(i.expansion)) }));
        const log = console.log; console.log = () => {};
        let produits; try { produits = await produitsDeLExpansion(cx.prod, L.exp); } finally { console.log = log; }
        const lignes = await cx.cartes.db.collection('cartes_produits').find({ idProduct: { $in: produits.map(p => p.idProduct) } }, { projection: { idProduct: 1, carteId: 1, preuve: 1 } }).toArray();
        fs.mkdirSync(path.join(__dirname, 'fixtures', 'nom-seul'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, 'fixtures', 'nom-seul', code + '.json'), JSON.stringify({ code, source: 'base cartes + production en lecture seule, 2026-11-01', L: { code: L.code, exp: L.exp, slugSet: L.slugSet, bulba: L.bulba }, cartes, produits, lignes }));
        console.log(code, 'cartes', cartes.length, 'produits', produits.length, 'lignes', lignes.length);
    } finally { await cx.fermer(); }
})().catch(e => { console.error(e.stack); process.exit(1); });
