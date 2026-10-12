// node test-retraits-base-banc.js — les deux écritures de retrait (R4, R7) sur une VRAIE base en mémoire (base-banc.js), jamais la production.
// Ce que la fausse base ne prouve pas : que `$pull: { sets: { $in } }` et `$pull: { impressions: { $or: [contenu exact] } }` retirent bien ce qui est
// listé, et rien d'autre (ni un voisin du même set, ni une impression au contenu presque identique), et qu'une rejouée ne touche plus rien.
// Lancer : MONGOMS_DOWNLOAD_DIR=<dépôt principal>/.banc-local/cache-mongod node test-retraits-base-banc.js
require('dotenv').config();
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const H = require('./retirer-homonymies-des-sets');
const I = require('./retirer-impressions-commentees');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) ok++; else { ko++; console.log(`  ✗ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
(async () => {
    const banc = await ouvrirBanc(); banc.appliquer();
    const cx = await mongoose.createConnection(banc.uri, { dbName: 'banc_retraits' }).asPromise();
    try {
        const col = cx.db.collection('cartes');
        // R4 : Pikachu (SV-P Promo 1) est dans 2 sets de la liste ET dans un 3e hors liste (jamais retiré) ; un voisin (autre _id) est dans les mêmes sets
        const SD = H.CIBLES.find(c => c.id === 282531);
        await col.insertMany([
            { _id: 282531, bulba: { titre: SD.titre }, sets: [...SD.sets, 'Hors-Liste'], impressions: [], nomFr: 'Pikachu', liens: { idProduct: [], idMetacards: [7] } },
            { _id: 999001, nomEn: 'Voisin', sets: [...SD.sets], impressions: [{ tirage: 'intl', expansion: 'X', numero: '1' }] },
            { _id: 23486, bulba: { titre: 'Darkness Energy (TCG)' }, sets: ['M-Master-Deck-Build-Box-Speed-Style'], impressions: [{ tirage: 'intl' }] }
        ]);
        const n1 = await H.appliquer(cx, SD, SD.sets);
        const apres = await col.findOne({ _id: 282531 });
        verifier('R4 : les 2 sets listés partent, le hors-liste reste', apres.sets, ['Hors-Liste']);
        verifier('R4 : nomFr et idMetacards intacts', [apres.nomFr, apres.liens.idMetacards], ['Pikachu', [7]]);
        verifier('R4 : le voisin n\'est pas touché', (await col.findOne({ _id: 999001 })).sets, SD.sets);
        verifier('R4 : modifiée 1', n1, 1);
        verifier('R4 : rejouée, plus rien à retirer (garde de la liste vide)', await H.appliquer(cx, SD, []), 0);
        // la garde « aucune impression » dans le filtre : une carte qui a gagné une impression ne perd rien
        const ED = H.CIBLES.find(c => c.id === 23486);
        verifier('R4 : une carte devenue une vraie carte (impression) n\'est pas touchée', [await H.appliquer(cx, ED, ED.sets.slice(0, 1)), (await col.findOne({ _id: 23486 })).sets], [0, ['M-Master-Deck-Build-Box-Speed-Style']]);

        // R7 : Mega Rayquaza ex a 3 fantômes, 2 légitimes et une impression au contenu PRESQUE identique (rareté d'un fantôme, mais total propre)
        const MR = I.CIBLES.find(c => c.id === 358136);
        const imp = (tirage, expansion, numero, total, rarete, extra = {}) => ({ tirage, expansion, deck: null, numero, total, rarete, illustrateur: null, ...extra });
        const avant = [
            imp('intl', 'Delta Reign', 'XXX', '103-->', 'Ultra Rare', { illustrateurPreuve: 'a' }),
            imp('jp', 'Storm Emeralda', '058', '076', 'RR'),
            imp('intl', 'Delta Reign', 'XXX', '103-->', 'Special Illustration Rare'),
            imp('intl', 'Delta Reign', 'XXX', '103', 'Ultra Rare'),                 // presque identique : total propre -> reste
            imp('intl', 'Delta Reign', 'XXX', '103-->', 'Mega Hyper Rare'),
            imp('jp', 'Storm Emeralda', '095', '076', 'SR')
        ];
        await col.insertMany([{ _id: 358136, nomEn: 'Mega Rayquaza ex', sets: ['Storm-Emeralda'], impressions: avant, images: [{ set: 'Storm-Emeralda', numero: '058' }] },
            { _id: 358137, nomEn: 'Autre', sets: [], impressions: [imp('intl', 'Delta Reign', 'XXX', '103-->', 'Ultra Rare')] }]);
        const n2 = await I.appliquer(cx, MR);
        const relu = await col.findOne({ _id: 358136 });
        verifier('R7 : modifiée 1', n2, 1);
        verifier('R7 : les 3 fantômes partent, les 3 autres restent dans l\'ordre', relu.impressions.map(i => `${i.tirage}|${i.numero}|${i.total}|${i.rarete}`), ['jp|058|076|RR', 'intl|XXX|103|Ultra Rare', 'jp|095|076|SR']);
        verifier('R7 : verifierRelu conforme à l\'attendu du plan', I.verifierRelu(MR, { impressions: avant }, relu), []);
        verifier('R7 : images et sets intacts', [relu.images, relu.sets], [[{ set: 'Storm-Emeralda', numero: '058' }], ['Storm-Emeralda']]);
        verifier('R7 : une autre carte (autre _id) au même contenu n\'est pas touchée', (await col.findOne({ _id: 358137 })).impressions.length, 1);
        verifier('R7 : rejouée, ne retire plus rien (modifiedCount 0)', await I.appliquer(cx, MR), 0);
    } finally {
        await cx.close().catch(() => { });
        await banc.arreter().catch(() => { });
    }
    console.log(`${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
