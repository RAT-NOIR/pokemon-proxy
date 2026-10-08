// node test-regle-r-fiches.js — la règle R de la désignation croisée (DOUBLONS-FICHES.md §4), SUR LA BASE EN MÉMOIRE (base-banc.js).
// Un test par cause (C1, C2a/R1, C3a/R2, C3b, C3e, C4a, C4b) + les refus que la règle ajoute par ce qu'elle n'autorise pas (C2b, C3c, C3d, C3f,
// hors périmètre, set illisible, collision du lot) + la GARDE DU SITE : l'écriture ne touche jamais `nomEn` ni l'ordre de `liens.idProduct`.
// Les documents sont FABRIQUÉS dans la base du banc et relus par `lireBases`, la lecture même de la production (poser-par-metacarte.js).
// Lancer : MONGOMS_DOWNLOAD_DIR=<dépôt principal>/.banc-local/cache-mongod node test-regle-r-fiches.js
require('dotenv').config();
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const R = require('./collecte-cartes/regle-r-fiches');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const SLUG = 'Set-R', EXP = 'Exp R', TIRAGE = 'zh-hans';
const RELEVE = { le: '2026-10-01', page: 'Exp R (TCG)', entrees: { [EXP]: 20 }, note: 'banc' };   // la forme réelle de `verifie` dans table-sets (un relevé, pas un booléen)
const L = { code: 'XR', slugSet: SLUG, exp: 1, verifie: RELEVE, bulba: { tirage: TIRAGE, expansion: EXP } };
const imp = numero => ({ tirage: TIRAGE, expansion: EXP, numero });
const carte = (id, nomEn, extra = {}) => ({ _id: id, nomEn, bulba: { titre: `${nomEn} (${EXP} ${id})` }, sets: [], impressions: [], liens: { idProduct: [id * 10], idMetacards: [] }, ...extra });
const CARTES = [
    carte(1, 'Alpha', { sets: [SLUG] }),                                                   // R1 : déjà membre
    carte(2, 'Bravo'),                                                                     // R2 : lien rouge n°20
    carte(3, 'Charlie'),                                                                   // C1 par impression : le n°30 est porté par Zulu
    carte(4, 'Delta'),                                                                     // C1 par numeroFiche d'une ligne
    carte(5, 'Echo'),                                                                      // C1 par le n° du produit d'une ligne
    carte(6, 'Foxtrot'),                                                                   // C3b : la Setlist a le n°60 mais d'autres noms
    carte(7, 'Golf'),                                                                      // C3e : lien rouge de même nom, autre forme de numéro
    carte(8, 'Hotel'),                                                                     // C4a : la Setlist ne nomme ni ce n° ni cette carte
    carte(9, 'India'),                                                                     // C3c : l'entrée de ce n° et de ce nom est une page réelle
    carte(10, 'Juliett'),                                                                  // C3d : page réelle de même nom ailleurs
    carte(11, 'Kilo'),                                                                     // C3f : un homonyme est déjà dans le set
    carte(12, 'Kilo', { sets: [SLUG], impressions: [imp('999')] }),
    carte(13, 'Lima', { sets: [SLUG], bulba: { titre: `Lima (${EXP} 130)` } }),                                                  // C2b : la Setlist liste sa page deux fois
    carte(14, 'Mike'),                                                                     // collision du lot (avec 15)
    carte(15, 'November'),
    carte(16, 'Oscar'),                                                                    // C3g : lien rouge au bon nom et au bon numéro, mais au jeton d'un AUTRE set
    carte(17, 'Quebec'),                                                                   // jeton reconnu par la table (prefixesParJeton)
    carte(26, 'Zulu', { sets: [SLUG], impressions: [imp('30')] }),
    carte(27, 'Yankee', { sets: [SLUG] }),                                                 // porte la ligne numeroFiche 40 (Delta)
    carte(28, 'Xray', { sets: [SLUG] }),                                                   // porte la ligne dont le produit est le n°50 (Echo)
    carte(40, 'Papa', { nomEn: 'Papa', liens: { idProduct: [] } })                         // liens vide : le garde-fou d'écriture (hors règle)
];
const LIGNES = [{ _id: '27|9027', idProduct: 9027, carteId: 27, slugSet: SLUG, numeroFiche: '40' }, { _id: '28|9028', idProduct: 9028, carteId: 28, slugSet: SLUG, numeroFiche: null }];
const PAGES = [
    { titre: `Bravo (${EXP} 20)`, etat: 'manquant' },
    { titre: `Autre (${EXP} 60)`, etat: 'ok' }, { titre: `Encore (${EXP} 60)`, etat: 'manquant' },
    { titre: `Golf (${EXP} Reward Pack 1)`, etat: 'manquant' },
    { titre: `Zulu (${EXP} 30)`, etat: 'ok' },
    { titre: `India (${EXP} 90)`, etat: 'ok' },
    { titre: `Juliett (${EXP} 100)`, etat: 'manquant' }, { titre: `Juliett (${EXP} 5)`, etat: 'ok' },
    { titre: `Kilo (${EXP} 110)`, etat: 'manquant' },
    { titre: `Lima (${EXP} 130)`, etat: 'ok' }, { titre: `Lima (${EXP} 130)`, etat: 'ok' },
    { titre: `Mike (${EXP} 140)`, etat: 'manquant' }, { titre: `November (${EXP} 140)`, etat: 'manquant' },
    { titre: 'Oscar (Autre Set 160)', etat: 'manquant' },                                   // une RÉIMPRESSION d'un autre set listée en passant
    { titre: `Quebec (${EXP} Reward Pack 170)`, etat: 'manquant' }
];
const p = (idProduct, numero, name = `Produit ${idProduct}`) => ({ idProduct, numero, name });
const numDe = new Map([[9028, '50']]);

async function main() {
    const banc = await ouvrirBanc(); banc.appliquer();
    const cx = await mongoose.createConnection(banc.uri, { dbName: 'banc_regle_r' }).asPromise();
    try {
        const db = cx.db;
        await db.collection('cartes').insertMany(CARTES);
        await db.collection('cartes_produits').insertMany(LIGNES);
        await db.collection('collecte_etat').insertMany([{ _id: SLUG, pages: PAGES }, { _id: 'Set-Vide', pages: [] }]);
        await db.collection('sets').insertMany([{ _id: SLUG, code: 'XR', region: 'intl', tirage: TIRAGE, bulba: { expansion: [EXP] } }, { _id: 'Set-Vide', code: 'XV', region: 'intl', tirage: TIRAGE, bulba: { expansion: ['Exp V'] } }]);
        const site = await R.chargerSite();
        const bases = await R.lireBases(db, lireMongo);
        const ctx = R.construireContexte(bases, site);
        const X = id => bases.cartes.find(c => c._id === id);
        const juger = (id, prod, ligne = L) => { const j = R.jugerRegleR(ctx, { L: ligne, p: prod, X: X(id), numDe }); return [j.autorise, j.regle, j.cause]; };

        // ── les causes que la règle AUTORISE
        verifier('C2a / R1 : la carte est déjà membre du set → rattachement', juger(1, p(9001, '10')), [true, 'R1', 'C2a']);
        verifier('C3a / R2 : lien rouge à CE numéro et de CE nom → fiche nouvelle', juger(2, p(9002, '020')), [true, 'R2', 'C3a']);
        // ── les causes qu'elle REFUSE
        verifier('C1 : le n° du produit est porté par l\'impression d\'une AUTRE carte du set', juger(3, p(9003, '030')), [false, null, 'C1']);
        verifier('C1 : le n° du produit est le numeroFiche d\'une ligne d\'une autre carte', juger(4, p(9004, '040')), [false, null, 'C1']);
        verifier('C1 : le n° du produit est celui du produit d\'une ligne d\'une autre carte', juger(5, p(9005, '050')), [false, null, 'C1']);
        verifier('C3b : la Setlist a ce n° mais d\'autres noms', juger(6, p(9006, '060')), [false, null, 'C3b']);
        verifier('C3e : lien rouge de même nom, autre forme de numéro (p001 / « Reward Pack 1 »)', juger(7, p(9007, 'p001')), [false, null, 'C3e']);
        verifier('C4a : la Setlist ne nomme ni ce n° ni cette carte', juger(8, p(9008, '080')), [false, null, 'C4a']);
        verifier('C4b : aucune Setlist lue (voie « sans page », `verifie.page` nul comme UNP)', juger(8, p(9008, '080'), { ...L, slugSet: 'Set-Vide', verifie: { le: '2026-09-24', page: null, note: 'sans page' } }), [false, null, 'C4b']);
        verifier('C3g : lien rouge au bon nom et au bon numéro mais au jeton d\'un AUTRE set → refusé', juger(16, p(9016, '160')), [false, null, 'C3g-jeton-etranger']);
        verifier('C3g : le jeton d\'une liste de la table (prefixesParJeton) est celui du set → R2', juger(17, p(9017, '170'), { ...L, bulba: { ...L.bulba, prefixesParJeton: { [`${EXP} Reward Pack`]: 'p' } } }), [true, 'R2', 'C3a']);
        verifier('C3g : sans cette entrée de la table, ce même jeton est étranger', juger(17, p(9017, '170')), [false, null, 'C3g-jeton-etranger']);
        // ── ce que la règle ajoute en n'autorisant que R1 et R2
        verifier('C3c : l\'entrée de ce n° et de ce nom est une page réelle → pas de fiche nouvelle', juger(9, p(9009, '090')), [false, null, 'C3c']);
        verifier('C3d : une page réelle de même nom existe ailleurs dans la Setlist', juger(10, p(9010, '100')), [false, null, 'C3d']);
        verifier('C3f : un homonyme est déjà dans le set', juger(11, p(9011, '110')), [false, null, 'C3f']);
        verifier('C2b : la Setlist liste deux fois la page de la carte membre', juger(13, p(9013, '130')), [false, null, 'C2b']);
        for (const [nom, v] of [['null (TK2, PPS1…)', null], ['absent', undefined], ['false', false], ['`true` nu (pas un relevé)', true], ['relevé sans clé page', { le: '2026-10-01' }], ['relevé sans date', { page: 'X (TCG)' }]]) {
            verifier(`hors périmètre : \`verifie\` ${nom}`, juger(1, p(9001, '10'), { ...L, verifie: v }), [false, null, 'HORS-PERIMETRE']);
        }
        verifier('set illisible : aucun document `sets` → je ne conclus pas', juger(1, p(9001, '10'), { ...L, slugSet: 'Set-Inconnu' }), [false, null, 'SET-ILLISIBLE']);

        // ── collision du lot : deux cartes autorisées au même n° dans le même set
        const a = { L, p: p(9014, '140'), X: X(14) }, b = { L, p: p(9015, '140'), X: X(15) };
        const res = [a, b].map(e => ({ ...e, j: R.jugerRegleR(ctx, { ...e, numDe }) }));
        verifier('lot : les deux sont autorisées une à une (R2)', res.map(r => r.j.autorise), [true, true]);
        verifier('lot : deux cartes au même n° dans le même set → les deux refusées (C1)', R.refuserCollisionsDuLot(res).map(r => [r.j.autorise, r.j.cause]), [[false, 'C1'], [false, 'C1']]);
        const meme = [{ ...a, j: res[0].j }, { ...a, p: p(9016, '140'), j: res[0].j }];
        verifier('lot : deux produits de la MÊME carte au même n° ne se heurtent pas', R.refuserCollisionsDuLot(meme).map(r => r.j.autorise), [true, true]);

        // ── l'exclusion nommée : liste fermée d'idProduct, chacun doit être un produit AUTORISÉ du lot, sinon elle lève
        const apresExclusion = R.exclureProduits(res, [9014]);
        verifier('exclusion : le produit nommé sort (cause EXCLU), l\'autre reste', apresExclusion.map(r => [r.j.autorise, r.j.cause]), [[false, 'EXCLU'], [true, 'C3a']]);
        const leve = (liste, ids) => { try { R.exclureProduits(liste, ids); return false; } catch (_) { return true; } };
        verifier('exclusion : un produit absent du lot lève (rien n\'est exclu en silence)', leve(res, [1]), true);
        verifier('exclusion : nommer un produit déjà refusé lève', leve(apresExclusion, [9014]), true);

        // ── LA GARDE DU SITE : `nomEn` et l'ordre de `liens.idProduct` ne bougent pas
        const avant = await db.collection('cartes').findOne({ _id: 2 });
        const parCarte = new Map([[2, { ids: [777, 20], metas: new Set([5]), sets: new Set([SLUG]) }]]);   // 20 = 10·2 y est DÉJÀ
        const ops = R.operationsCartes(parCarte);
        R.garderEcritureSite(ops);
        await db.collection('cartes').bulkWrite(ops);
        const apres = await db.collection('cartes').findOne({ _id: 2 });
        verifier('garde du site : nomEn inchangé', apres.nomEn, avant.nomEn);
        verifier('garde du site : liens.idProduct[0] inchangé', apres.liens.idProduct[0], avant.liens.idProduct[0]);
        verifier('garde du site : l\'idProduct neuf est ajouté EN FIN, l\'existant ne bouge pas', apres.liens.idProduct, [20, 777]);
        verifier('garde du site : le set est ajouté', apres.sets, [SLUG]);
        await db.collection('cartes').updateOne({ _id: 2 }, { $set: { 'liens.idProduct': [30, 20, 10] } });
        await db.collection('cartes').bulkWrite(R.operationsCartes(new Map([[2, { ids: [10, 999, 20], metas: new Set(), sets: new Set([SLUG]) }]])));
        verifier('garde du site : $addToSet n\'ordonne rien — [30, 20, 10] + [10, 999, 20] → [30, 20, 10, 999]', (await db.collection('cartes').findOne({ _id: 2 })).liens.idProduct, [30, 20, 10, 999]);
        const refuse = (nom, op) => { let m = null; try { R.garderEcritureSite([op]); } catch (e) { m = e.message; } verifier(`garde du site : refuse ${nom}`, m !== null, true); };
        refuse('un $set de nomEn', { updateOne: { filter: { _id: 2 }, update: { $set: { nomEn: 'X' } } } });
        refuse('un $addToSet sur nomEn', { updateOne: { filter: { _id: 2 }, update: { $addToSet: { nomEn: { $each: ['X'] } } } } });
        refuse('un $push sur liens.idProduct', { updateOne: { filter: { _id: 2 }, update: { $push: { 'liens.idProduct': { $each: [1], $position: 0 } } } } });
        refuse('un $addToSet qui porte aussi un $pull', { updateOne: { filter: { _id: 2 }, update: { $addToSet: { sets: { $each: ['A'] } }, $pull: { sets: 'B' } } } });
        refuse('un $addToSet sur un autre champ (impressions)', { updateOne: { filter: { _id: 2 }, update: { $addToSet: { impressions: { $each: [{}] } } } } });
        refuse('une opération autre que updateOne', { deleteOne: { filter: { _id: 2 } } });
        refuse('un upsert (créerait un document sans nomEn)', { updateOne: { filter: { _id: 2 }, update: { $addToSet: { sets: { $each: ['A'] } } }, upsert: true } });
        const ctl = R.controlerRepere(bases.cartes, new Map([[2, { ids: [20, 777] }], [40, { ids: [5] }], [1, { ids: [] }]]));
        verifier('contrôle des repères : conservé là où il existe, vide nommé, aucun déplacé', [ctl.cartes, ctl.avecRepere, ctl.repereConserve, ctl.deplaces, ctl.sansRepere], [3, 2, 2, [], [40]]);
        verifier('liens vide : la mesure existe (le premier idProduct écrit deviendrait le repère)', R.cartesSansRepere(bases.cartes, [40, 2]), [40]);
    } finally {
        await cx.close().catch(() => { });
        await banc.arreter().catch(() => { });
    }
    console.log(`\n${ok} passés, ${ko} en échec (dénominateur : ${ok + ko})`);
    process.exit(ko ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
