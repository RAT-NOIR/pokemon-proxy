// TEST — appartenance par produit (2026-11-07). Règle du testeur du 03/11 : une fiche sans produit dans son set est un clone ; le collecteur n'inscrit donc
// le slug dans `cartes.sets` que pour les cartes qui ont un produit du set. Pur : aucune base. Rouge d'abord : le module n'existait pas.
const A = require('./collecte-cartes/appartenance-par-produit');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) ok++; else { ko++; console.log(`  ✗ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const leve = (nom, f) => { try { f(); ko++; console.log(`  ✗ ${nom} : aurait dû lever`); } catch { ok++; } };
const S = 'Set-Test';
const carte = (id, sets = []) => ({ _id: id, sets });
const ligne = (carteId, slugSet = S) => ({ carteId, slugSet });

// aUnProduitDuSet
verifier('ligne du set', A.aUnProduitDuSet(1, S, [ligne(1)], []), true);
verifier('ligne d\'un AUTRE set : non', A.aUnProduitDuSet(1, S, [ligne(1, 'Autre')], []), false);
verifier('ligne d\'une autre carte : non', A.aUnProduitDuSet(1, S, [ligne(2)], []), false);
verifier('produit SANS_LIGNE attribué (fiche)', A.aUnProduitDuSet(1, S, [], [{ fiche: { carteId: 1, setId: S } }]), true);
verifier('produit attribué à un autre set : non', A.aUnProduitDuSet(1, S, [], [{ fiche: { carteId: 1, setId: 'Autre' } }]), false);
verifier('rien du tout : non', A.aUnProduitDuSet(1, S, [], []), false);

// cartesAAjouterAuSet
const R1 = A.cartesAAjouterAuSet(S, [carte(1), carte(2), carte(3)], [ligne(1), ligne(3)]);
verifier('carte avec ligne reçoit le slug, sans ligne refusée', [R1.ajouter, R1.refusees], [[1, 3], [{ carteId: 2, raison: 'sans-produit-du-set' }]]);
const R2 = A.cartesAAjouterAuSet(S, [carte(1)], [], [{ fiche: { carteId: 1, setId: S } }]);
verifier('carte avec produit SANS_LIGNE attribué reçoit le slug', R2.ajouter, [1]);
const R3 = A.cartesAAjouterAuSet(S, [carte(1, [S]), carte(2, [S, 'X'])], [ligne(1)]);
verifier('déjà membre : ni ajoutée ni refusée (additif, ne retire rien), même sans produit', [R3.ajouter, R3.refusees, R3.dejaMembres], [[], [], [1, 2]]);
// Énergie de base partagée par 50 sets : une seule ligne dans CE set suffit, les 49 autres sets sont sans effet
const sets50 = Array.from({ length: 50 }, (_, i) => `S${i}`);
const R4 = A.cartesAAjouterAuSet('S7', [carte(9, sets50.filter(s => s !== 'S7'))], [ligne(9, 'S7'), ligne(9, 'S8')]);
verifier('Énergie de base à 50 sets : ajoutée dans S7 par sa ligne de S7', R4.ajouter, [9]);
const R5 = A.cartesAAjouterAuSet('S7', [carte(9, sets50.filter(s => s !== 'S7'))], [ligne(9, 'S8'), ligne(9, 'S9')]);
verifier('Énergie de base : lignes des AUTRES sets seulement -> refusée dans S7', [R5.ajouter, R5.refusees.length], [[], 1]);
const R6 = A.cartesAAjouterAuSet(S, [carte(1), carte(2)], []);
verifier('set sans produit du tout : rien ajouté, et c\'est dit', [R6.ajouter, R6.refusees.length, R6.setSansProduit, typeof R6.message], [[], 2, true, 'string']);
verifier('le message du set sans produit nomme le set', R6.message.includes(S), true);
verifier('set avec produits : setSansProduit faux', R1.setSansProduit, false);
leve('slug vide refusé', () => A.cartesAAjouterAuSet('', [carte(1)], [ligne(1, '')]));
leve('slug null refusé', () => A.cartesAAjouterAuSet(null, [carte(1)], []));
leve('slug d\'espaces refusé', () => A.cartesAAjouterAuSet('   ', [carte(1)], []));
leve('cartes non tableau refusé', () => A.cartesAAjouterAuSet(S, null, []));
const R7 = A.cartesAAjouterAuSet(S, [carte(1), carte(1)], [ligne(1)]);
verifier('doublon de carte compté une fois', R7.ajouter, [1]);
verifier('population vide : rien, sans lever', A.cartesAAjouterAuSet(S, [], [ligne(1)]).ajouter, []);
verifier('dénominateur : posées + refusées + déjà = candidates', [R1.ajouter.length + R1.refusees.length + R1.dejaMembres.length], [3]);

// ── A. lignesDuSetPourAppartenance : le slugSet RÉEL de la ligne est gardé (jamais forcé), les lignes détachées sont exclues
const L1 = A.lignesDuSetPourAppartenance([{ _id: '1|10', carteId: 1, idProduct: 10, slugSet: 'Frere' }, { _id: '2|20', carteId: 2, idProduct: 20, slugSet: S }, { _id: '3|30', carteId: 3, idProduct: 30, slugSet: S }], new Set(['3|30']));
verifier('slugSet réel gardé, ligne détachée exclue', L1, [{ carteId: 1, slugSet: 'Frere' }, { carteId: 2, slugSet: S }]);
verifier('ligne sans slugSet : slugSet null (jamais forcé au slug)', A.lignesDuSetPourAppartenance([{ _id: '4|1', carteId: 4, idProduct: 1 }], new Set()), [{ carteId: 4, slugSet: null }]);
leve('interdits absents : refusé (pas de repli)', () => A.lignesDuSetPourAppartenance([], null));

module.exports = (async () => {
    // ── A. poserAppartenances sur fausse base : deux sets frères sur le même idExpansion (Happy Sets, trainer kits)
    const lignesBase = [
        { _id: '1|10', carteId: 1, idProduct: 10, idExpansion: 99, slugSet: S },
        { _id: '2|20', carteId: 2, idProduct: 20, idExpansion: 99, slugSet: 'Set-Frere' },      // ligne du FRÈRE seulement
        { _id: '3|30', carteId: 3, idProduct: 30, idExpansion: 99, slugSet: S },                // ligne détachée
        { _id: '5|50', carteId: 5, idProduct: 50, idExpansion: 7, slugSet: S }                  // autre expansion
    ];
    const ecrits = [], requetes = [];
    const M = {
        CarteProduit: { find: q => { requetes.push(q); return { select: () => ({ lean: async () => lignesBase.filter(l => q.carteId.$in.includes(l.carteId) && l.idExpansion === q.idExpansion) }) }; } },
        Carte: { updateMany: async (f, u) => { ecrits.push([f, u]); return {}; } }
    };
    const cartes = [carte(1), carte(2), carte(3), carte(4), carte(6, [S])];
    const AP = await A.poserAppartenances({ M, slug: S, exp: 99, cartes, interdits: new Set(['3|30']) });
    verifier('fausse base : seule la carte à ligne du set reçoit le slug', AP.ajouter, [1]);
    verifier('fausse base : frère, détachée, sans ligne -> refusées sans produit du set', AP.refusees.map(r => r.carteId), [2, 3, 4]);
    verifier('fausse base : déjà membre non touchée', AP.dejaMembres, [6]);
    verifier('fausse base : UNE écriture, $addToSet du seul slug, sur les seules retenues', ecrits, [[{ _id: { $in: [1] } }, { $addToSet: { sets: S } }]]);
    verifier('fausse base : la lecture filtre sur l\'idExpansion et les cartes candidates', requetes[0], { carteId: { $in: [1, 2, 3, 4, 6] }, idExpansion: 99 });
    ecrits.length = 0;
    const AP0 = await A.poserAppartenances({ M, slug: S, exp: 12345, cartes, interdits: new Set() });
    verifier('fausse base : set sans produit -> aucune écriture, dit', [AP0.ajouter, ecrits.length, AP0.setSansProduit], [[], 0, true]);

    // ── candidates() sur une fausse collecte_etat : pages ok / manquant / exécution courante
    const requetesC = [];
    const McC = {
        Etat: { findById: () => ({ select: () => ({ lean: async () => ({ pages: [
            { titre: 'a', pageid: 11, etat: 'ok' }, { titre: 'b', pageid: null, etat: 'manquant' }, { titre: 'c', pageid: 13, etat: 'homonymie' },
            { titre: 'd', pageid: 14, etat: 'ok' }, { titre: 'e', pageid: 11, etat: 'ok' }] }) }) }) },
        Carte: { find: q => { requetesC.push(q); const o = { select: () => o, lean: async () => [] }; return o; } }
    };
    const courante = new Set([15, 14]);
    const cand = A.fabriquerCandidates({ M: McC, slug: S, pagesEcrites: courante });
    await cand();
    verifier('candidates : membres ∪ pages ok (dédoublonnées) ∪ exécution courante ; manquant et homonymie exclues', requetesC[0], { $or: [{ sets: S }, { _id: { $in: [11, 14, 15] } }] });
    courante.add(16); await cand('_id');
    verifier('candidates : relit l\'exécution courante à chaque appel', requetesC[1].$or[1]._id.$in, [11, 14, 15, 16]);

    // ── B. ecrirePageDeCarte : poserAppartenance obligatoire (la fausse base ne voit aucune écriture)
    const PDC = require('./collecte-cartes/page-de-carte');
    const appels = [];
    const fM = { Carte: { updateOne: async () => { appels.push('Carte'); return {}; }, findById: () => ({ select: () => ({ lean: async () => null }) }) }, Etat: { updateOne: async () => { appels.push('Etat'); return {}; } }, Reste: { updateOne: async () => { appels.push('Reste'); return {}; } } };
    const fR2 = { cleWikitext: () => 'k', deposerTexte: async () => { appels.push('R2'); return { ecrit: true }; } };
    const ctxB = { M: fM, r2: fR2, bucket: 'B', pg: { title: 'Oddish (SVP Promo 102)', pageid: 1, revid: 2, content: require('fs').readFileSync(require('path').join(__dirname, 'collecte-cartes', 'r47-fixtures', 'oddish-svp-102.wikitext'), 'utf8') }, slug: S, lot: ['Oddish (SVP Promo 102)'], redirigeDepuisTout: new Map(), D: { epure: {} }, textesEpures: new Map(), compter: () => {}, impressionCible: () => null, compteRequetes: () => 1 };
    let errB = null; try { await PDC.ecrirePageDeCarte(ctxB); } catch (e) { errB = e.message; }
    verifier('B : poserAppartenance absent -> exception nommée, aucune écriture', [typeof errB === 'string' && errB.includes('poserAppartenance'), appels], [true, []]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    if (ko) throw new Error(`${ko} assertion(s) en échec`);   // lève : le banc de mutants le rejoue
})();   // la promesse est exportée : le banc de mutants l'attend
