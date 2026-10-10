// Banc de collecte-cartes/historique-valeur.js — base EN MÉMOIRE (collecte-cartes/base-banc.js), faux client R2 : aucune écriture
// dans la grappe de production, aucune écriture R2 réelle.
//   node test-historique-valeur.js
const zlib = require('zlib');
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');

let echecs = 0, n = 0;
// JSON.stringify change Infinity et NaN en null : ils sont repérés AVANT la comparaison et ne passent jamais pour un null
const nonFini = v => typeof v === 'number' ? (v === Infinity || v === -Infinity || Number.isNaN(v)) : (v && typeof v === 'object' ? Object.values(v).some(nonFini) : false);
const verifier = (nom, obtenu, attendu) => { n++; const ok = !nonFini(obtenu) && JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };

// faux R2 : une Map ; `panne` fait échouer toute écriture
const fauxR2 = () => {
    const f = { fichiers: new Map(), depots: 0, panne: false };
    f.existe = async (b, c) => f.fichiers.has(`${b}/${c}`);
    f.deposerBinaire = async (b, c, buf) => { if (f.panne) throw new Error('R2 en panne (faux)'); f.depots++; f.fichiers.set(`${b}/${c}`, buf); };
    f.lireBinaire = async (b, c) => f.fichiers.get(`${b}/${c}`);
    return f;
};
const muet = { log() { }, error() { } };

(async () => {
    const banc = await ouvrirBanc();
    banc.appliquer();
    const cxProd = await mongoose.createConnection(banc.uri, { dbName: 'banc_prod' }).asPromise();
    const cxCartes = await mongoose.createConnection(banc.uri, { dbName: 'banc_cartes' }).asPromise();
    try {
        const H = require('./collecte-cartes/historique-valeur');
        const prod = cxProd.db, cartes = cxCartes.db;
        const G1 = new Date('2026-10-07T00:00:00Z'), G0 = new Date('2026-10-01T00:00:00Z');
        // données fabriquées. Set A : 3 cartes valorisées dont deux à égalité au sommet, un produit sans tendance, un périmé (guide plus ancien), une carte-code
        await cartes.collection('sets').insertMany([
            { _id: 'A', nomAffichage: 'Set A', idExpansion: [1] },
            { _id: 'B', nomAffichage: 'Set B', idExpansion: [2] },
            { _id: 'C', idExpansion: [3] },                           // sans nomAffichage : non publié, jamais compté
            { _id: 'D', nomAffichage: 'Set D', idExpansion: [4] }     // publié, aucun produit valorisé
        ]);
        await prod.collection('catalogue_produits').insertMany([
            { idProduct: 10, idExpansion: 1, name: 'Alpha' }, { idProduct: 11, idExpansion: 1, name: 'Beta' }, { idProduct: 12, idExpansion: 1, name: 'Gamma' },
            { idProduct: 13, idExpansion: 1, name: 'Delta Online Code Card' }, { idProduct: 14, idExpansion: 1, name: 'Epsilon (périmé)' },
            { idProduct: 20, idExpansion: 2, name: 'Zeta' }, { idProduct: 21, idExpansion: 2, name: 'Eta' },
            { idProduct: 30, idExpansion: 3, name: 'Hors set publié' },
            { idProduct: 40, idExpansion: 4, name: 'Theta' }
        ]);
        await prod.collection('guide_prix').insertMany([
            { idProduct: 10, trend: 5.05, guideDu: G1 }, { idProduct: 11, trend: 5.05, guideDu: G1 },   // égalité au sommet de A
            { idProduct: 12, trend: null, guideDu: G1 },                                                  // sans tendance
            { idProduct: 13, trend: 999, guideDu: G1 },                                                   // carte-code : exclue
            { idProduct: 14, trend: 50, guideDu: G0 },                                                    // absent du dernier guide : prix périmé, exclu
            { idProduct: 20, trend: 1.1, guideDu: G1 }, { idProduct: 21, trend: 2.2, guideDu: G1 },
            { idProduct: 30, trend: 7, guideDu: G1 },
            { idProduct: 40, trend: 0, guideDu: G1 }                                                      // 0 = pas de prix
        ]);
        await prod.collection('guide_prix_meta').insertOne({ _id: 'dernier', guideDu: G1 });
        const r2 = fauxR2();
        const dep = { prod, cartes, r2, bucket: 'brut-banc', journal: muet };
        const lignes = async () => Object.fromEntries((await cartes.collection('histo_valeur_sets').find({}).toArray()).map(l => [l._id, l]));

        // 1. la somme, la carte phare et les dénominateurs, justes sur des données fabriquées
        const r = await H.historiserGuide(dep);
        const L = await lignes();
        verifier('statut et nombre de lignes : un par set PUBLIÉ (A, B, D), pas C', [r.statut, Object.keys(L).sort()], ['ecrit', ['A|2026-10-07', 'B|2026-10-07', 'D|2026-10-07']]);
        verifier('A : valeur 1010 centimes (5,05 + 5,05), 4 produits (carte-code exclue), 2 valorisés (sans tendance et périmé comptés à part)', [L['A|2026-10-07'].valeurCt, L['A|2026-10-07'].produits, L['A|2026-10-07'].produitsValorises], [1010, 4, 2]);
        verifier('A : égalité au sommet → le plus petit idProduct (10), prix en centimes', L['A|2026-10-07'].phare, { idProduct: 10, prixCt: 505 });
        verifier('B : valeur 330 centimes, phare 21 à 220', [L['B|2026-10-07'].valeurCt, L['B|2026-10-07'].produitsValorises, L['B|2026-10-07'].phare], [330, 2, { idProduct: 21, prixCt: 220 }]);
        verifier('D : un prix de 0 n\'est pas une tendance : valeurCt 0, 0 valorisé sur 1, phare null', [L['D|2026-10-07'].valeurCt, L['D|2026-10-07'].produits, L['D|2026-10-07'].produitsValorises, L['D|2026-10-07'].phare], [0, 1, 0, null]);
        verifier('la date est celle du GUIDE (dans l\'_id) ; aucun champ ne répète l\'_id (set, jour, guideDu) ; valeurCt entier', [Object.keys(L['A|2026-10-07']).sort(), Number.isInteger(L['A|2026-10-07'].valeurCt)], [['_id', 'phare', 'produits', 'produitsValorises', 'valeurCt'], true]);
        // le fichier R2 du jour : idProduct -> tendance, tendances valides du guide du jour seulement
        const brut = JSON.parse(zlib.gunzipSync(r2.fichiers.get('brut-banc/historique-prix/2026-10-07.json.gz')).toString('utf8'));
        verifier('fichier R2 : clé historique-prix/AAAA-MM-JJ.json.gz, idProduct -> tendance (guide du jour, tendance > 0)', [brut.guideDu, brut.tendances], ['2026-10-07T00:00:00.000Z', { 10: 5.05, 11: 5.05, 13: 999, 20: 1.1, 21: 2.2, 30: 7 }]);

        // 2. le même guide deux fois : une seule ligne par set, un seul fichier
        const r2bis = await H.historiserGuide(dep);
        verifier('même guide une seconde fois : « deja-historise », 3 lignes, 1 dépôt R2', [r2bis.statut, Object.keys(await lignes()).length, r2.depots], ['deja-historise', 3, 1]);

        // 3. un nouveau guide : de nouvelles lignes, un second fichier, les anciennes lignes intactes
        const G2 = new Date('2026-10-08T00:00:00Z');
        await prod.collection('guide_prix').updateMany({ idProduct: { $in: [10, 11, 20, 21] } }, { $set: { guideDu: G2, trend: 9 } });
        await prod.collection('guide_prix_meta').updateOne({ _id: 'dernier' }, { $set: { guideDu: G2 } });
        const r3 = await H.historiserGuide(dep);
        const L3 = await lignes();
        verifier('guide suivant : 6 lignes, 2 fichiers, la ligne de la veille intacte', [r3.statut, Object.keys(L3).length, r2.fichiers.size, L3['A|2026-10-07'].valeurCt, L3['A|2026-10-08'].valeurCt], ['ecrit', 6, 2, 1010, 1800]);

        // 4. échec R2 : l'historique ne lève JAMAIS (l'import du guide réussit quand même), le dit, et une reprise complète le fichier
        const G3 = new Date('2026-10-09T00:00:00Z');
        await prod.collection('guide_prix').updateMany({ idProduct: { $in: [10, 11] } }, { $set: { guideDu: G3 } });
        await prod.collection('guide_prix_meta').updateOne({ _id: 'dernier' }, { $set: { guideDu: G3 } });
        r2.panne = true;
        const sorties = [];
        const r4 = await H.historiserSansEchec({ ...dep, journal: { log: m => sorties.push(m), error: m => sorties.push(m) } });
        verifier('R2 en panne : aucune exception, statut « echec », l\'erreur est journalisée', [r4.statut, sorties.some(s => /R2 en panne/.test(s))], ['echec', true]);
        r2.panne = false;
        const r5 = await H.historiserSansEchec(dep);
        verifier('reprise après la panne : le fichier manquant est écrit, pas de doublon de lignes', [r5.statut, r2.fichiers.has('brut-banc/historique-prix/2026-10-09.json.gz'), Object.keys(await lignes()).length], ['ecrit', true, 9]);

        // 5. rien à historiser : méta absente, ou aucun set publié → rien d'écrit, dit (jamais un zéro silencieux)
        const avant = (await lignes(), r2.fichiers.size);
        await prod.collection('guide_prix_meta').deleteOne({ _id: 'dernier' });
        const r6 = await H.historiserSansEchec(dep);
        verifier('méta du guide absente : « echec » nommé, rien écrit', [r6.statut, r2.fichiers.size], ['echec', avant]);
        await prod.collection('guide_prix_meta').insertOne({ _id: 'dernier', guideDu: new Date('2026-10-10T00:00:00Z') });
        const r7 = await H.historiserSansEchec(dep);
        verifier('méta datée d\'un guide dont aucune ligne n\'existe : refus (un plein ou un vide fabriqué ne s\'écrit pas)', [r7.statut, r2.fichiers.size, Object.keys(await lignes()).length], ['echec', avant, 9]);

        // 5 bis. le crochet de l'import : ses propres connexions, ne lève jamais
        const envBanc = { MONGODB_URI: banc.uri, MONGODB_CARTES_URI: banc.uri, R2_BUCKET_BRUT: 'brut-banc' };
        const r8 = await H.historiserApresImport({ base: 'banc_prod', env: { ...envBanc, MONGODB_CARTES_URI: '' }, mongoose, r2, journal: muet });
        verifier('crochet : variable absente → « echec » nommé, aucune exception', [r8.statut, /MONGODB_CARTES_URI/.test(r8.erreur)], ['echec', true]);
        await cartes.collection('sets').updateOne({ _id: 'D' }, { $set: { nomAffichage: 'Set D' } });
        await prod.collection('guide_prix_meta').updateOne({ _id: 'dernier' }, { $set: { guideDu: G3 } });
        const r9 = await H.historiserApresImport({ base: 'banc_prod', baseCartes: 'banc_cartes', env: envBanc, mongoose, r2, journal: muet });
        verifier('crochet (guide déjà historisé) : ses connexions s\'ouvrent sur la base « cartes » du banc, rien de plus écrit', [r9.statut, Object.keys(await lignes()).length], ['deja-historise', 9]);

        // 5 quater. un historique qui ne répond JAMAIS ne retient pas l'import au-delà du délai (injecté : 300 ms, pas 120 s)
        const pendu = { ...r2, existe: () => new Promise(() => { }) };
        await prod.collection('guide_prix_meta').updateOne({ _id: 'dernier' }, { $set: { guideDu: G3 } });
        const t0 = Date.now(), sortiesD = [];
        const garde = new Promise(ok => setTimeout(() => ok({ statut: 'RETENU' }), 5000));
        const rD = await Promise.race([H.historiserApresImport({ base: 'banc_prod', baseCartes: 'banc_cartes', env: envBanc, mongoose, r2: pendu, delaiMs: 300, journal: { log: m => sortiesD.push(m), error: m => sortiesD.push(m) } }), garde]);
        verifier('historique qui ne répond jamais : rendu après le délai (< 3 s), statut « echec », le délai est dit', [rD.statut, Date.now() - t0 < 3000, sortiesD.some(s => /délai/.test(s))], ['echec', true, true]);

        // 5 sexies. LA MESURE lit le jour là où l'_id est fabriqué (un seul exemplaire), sur des lignes de la FORME FINALE (celle que calculerInstantanes produit)
        const col = cartes.collection('histo_valeur_sets');
        await col.insertOne({ _id: 'pas-de-jour', valeurCt: 1, produits: 1, produitsValorises: 1, phare: null });
        const m = await H.mesurerHistorique(col);
        verifier('mesure : 10 lignes dont 9 datées sur 3 jours, bornes 07 → 09, 1 _id mal formé compté à part avec son exemple',
            [m.lignes, m.jours, m.premier, m.dernier, m.malformees, m.exempleMalforme], [10, 3, '2026-10-07', '2026-10-09', 1, 'pas-de-jour']);
        verifier('mesure : le poids par jour est fini (total / 3 jours)', [H.poidsParJour(3000, m.jours), Number.isFinite(H.poidsParJour(3000, m.jours))], [1000, true]);
        verifier('jourDeLigne : après le DERNIER « | », forme AAAA-MM-JJ exigée (un slug peut porter « | »)', [H.jourDeLigne('a|b|2026-10-07'), H.jourDeLigne('A|2026-13-45x'), H.jourDeLigne('A|2026-10-7'), H.jourDeLigne(42)], ['2026-10-07', null, null, null]);
        await col.deleteOne({ _id: 'pas-de-jour' });
        const vide = await H.mesurerHistorique(cartes.collection('collection_vide_banc'));
        verifier('0 ligne → 0 jour, bornes null', [vide.lignes, vide.jours, vide.premier], [0, 0, null]);
        // hors JSON.stringify : Object.is distingue null de Infinity et de NaN
        verifier('zéro jour n\'est jamais un dénominateur : poidsParJour(5000, 0) et (…, vide.jours) sont EXACTEMENT null (Object.is, ni Infinity ni NaN)',
            [Object.is(H.poidsParJour(5000, 0), null), Object.is(H.poidsParJour(5000, vide.jours), null), Object.is(H.poidsParJour(0, 0), null)], [true, true, true]);
        verifier('poidsParJour : valeur exacte et finie sur 3 jours (Object.is)', [Object.is(H.poidsParJour(3000, 3), 1000)], [true]);

        // 5 septies. LE VERDICT de --mesure (pure, exportée) : code de sortie et lignes imprimées
        const vN0 = H.verdictMesure({ lignes: 761, jours: 0, premier: null, dernier: null, malformees: 761, exempleMalforme: 'x' });
        verifier('verdict : N lignes et 0 jour → code 1, « aucun jour mesurable », non mesurable', [vN0.code, vN0.mesurable, vN0.lignes.some(l => /aucun jour mesurable/.test(l))], [1, false, true]);
        const v00 = H.verdictMesure({ lignes: 0, jours: 0, premier: null, dernier: null, malformees: 0, exempleMalforme: null });
        verifier('verdict : 0 ligne → code 0, rien à mesurer, rien à diviser', [v00.code, v00.mesurable, v00.lignes.some(l => /rien à mesurer/.test(l))], [0, false, true]);
        const vOk = H.verdictMesure({ lignes: 761, jours: 1, premier: '2026-10-10', dernier: '2026-10-10', malformees: 0, exempleMalforme: null });
        verifier('verdict : cas normal → code 0, mesurable, aucune ligne d\'alerte', [vOk.code, vOk.mesurable, vOk.lignes], [0, true, []]);
        const vMal = H.verdictMesure({ lignes: 5, jours: 2, premier: 'a', dernier: 'b', malformees: 1, exempleMalforme: 'zz' });
        verifier('verdict : des _id mal formés avec des jours → code 0, mesurable, l\'exemple est imprimé', [vMal.code, vMal.mesurable, vMal.lignes.length, /zz/.test(vMal.lignes[0])], [0, true, 1, true]);
        await col.insertOne({ _id: 'sans-forme', valeurCt: 1, produits: 1, produitsValorises: 1, phare: null });
        await col.deleteMany({ _id: /\|/ });
        const seul = await H.mesurerHistorique(col);
        verifier('des lignes mais AUCUN jour reconnu : jours 0, malformées 1 (la sonde ne devine pas)', [seul.lignes, seul.jours, seul.malformees], [1, 0, 1]);
        await col.deleteOne({ _id: 'sans-forme' });

        // 6. fonctions pures
        const p = H.calculerInstantanes({ sets: [{ _id: 'X', nomAffichage: 'X', idExpansion: [9] }], produits: [{ idProduct: 1, idExpansion: 9, name: 'a' }], tendances: new Map([[1, 0.1], [2, 0.2]]), jour: '2026-10-07', guideDu: G1 });
        verifier('somme en centimes (pas de dérive flottante) : 0,1 valeur 0,1', [p[0].valeurCt, p[0].produitsValorises], [10, 1]);
    } finally {
        await Promise.allSettled([cxProd.close(), cxCartes.close(), mongoose.disconnect()]);
        await banc.arreter();
    }
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (base en mémoire, faux R2)`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
