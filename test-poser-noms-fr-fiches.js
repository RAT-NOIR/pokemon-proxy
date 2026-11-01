// Banc de poser-noms-fr-fiches.js (aucune base, aucun réseau) : la PLANIFICATION est une fonction pure, on la fait dire NON sur des états fabriqués.
// (A) ajout aux cartes à _id négatif SANS champ nomFr ; (B) cartes à nomFr null (source cardmarket) remplies si le clone TCGdex local concorde,
// avec un lien carte <-> carte TCGdex PROUVÉ indépendamment de la clé (l'identifiant Cardmarket).
const { spawnSync } = require('child_process');
const path = require('path');
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };

const P = require('./collecte-cartes/plan-noms-fr-fiches');
const M = require('./collecte-cartes/nom-fr-cardmarket');

const frDe = produits => M.frParProduit(produits);
const prod = (idProduct, nomFr) => ({ idProduct, nomFr });

// ============ (A) ============
{
    const produits = [prod(1, 'Élektek'), prod(2, 'Elektek (V.2)'), prod(3, 'Double Énergie Incolore'), prod(4, 'Double Colorless Energy'),
        prod(5, 'Léo'), prod(6, 'Abra'), prod(7, 'Tortank'), prod(8, null)];
    const cartes = [
        { _id: -1, nomEn: 'Electabuzz' },                                                       // sans champ : A, accents départagés
        { _id: -2, nomEn: 'Double Colorless Energy' },                                          // sans champ : A, conflit -> null
        { _id: -3, nomEn: 'Lillie' },                                                           // sans champ : A, nom simple
        { _id: -4, nomEn: 'Abra', nomFr: 'Abra déjà posé', nomFrSource: 'cardmarket' },         // DÉJÀ NOMMÉE (chaîne) : jamais touchée
        { _id: -5, nomEn: 'Blastoise', nomFr: null, nomFrSource: 'cardmarket' },                // nomFr null : ce n'est pas (A)
        { _id: 100, nomEn: 'Lillie' },                                                          // positive sans champ : hors lot
        { _id: -6, nomEn: 'Rien' },                                                             // sans champ mais aucun produit à nomFr : pas touchée
    ];
    const liens = [{ carteId: -1, idProduct: 1 }, { carteId: -1, idProduct: 2 }, { carteId: -2, idProduct: 3 }, { carteId: -2, idProduct: 4 },
        { carteId: -3, idProduct: 5 }, { carteId: -4, idProduct: 6 }, { carteId: -5, idProduct: 3 }, { carteId: -5, idProduct: 4 },
        { carteId: 100, idProduct: 5 }, { carteId: -6, idProduct: 8 }];
    const r = P.planifierA({ cartes, liens, frDuProduit: frDe(produits) });
    const par = Object.fromEntries(r.ecrire.map(x => [x.carteId, x]));
    egal('A1 accents départagés : la forme accentuée', par[-1]?.nomFr, 'Élektek');
    egal('A2 conflit entre produits : null écrit, comme rapatrier', par[-2] && par[-2].nomFr, null);
    egal('A2b ... et le conflit est marqué', par[-2]?.conflit, true);
    egal('A3 nom simple', par[-3]?.nomFr, 'Léo');
    egal('A4 carte déjà nommée (chaîne) : JAMAIS dans le plan', -4 in par, false);
    egal('A5 nomFr null existant : jamais dans (A)', -5 in par, false);
    egal('A6 carte positive hors lot : jamais dans (A), mais comptée', [100 in par, r.horsLotPositives], [false, 1]);
    egal('A7 aucun produit à nomFr : pas de champ posé', [-6 in par, r.sansProduitFr], [false, 1]);
    egal('A8 compte des cartes déjà nommées ou à null, ignorées', r.dejaNommeesOuNulles, 2);
    egal('A9 total du plan', r.ecrire.length, 3);
    // défaut mécanique : un plan (A) ne contient JAMAIS une carte dont le champ existe
    egal('A10 invariant : aucune carte du plan n\'avait de champ', r.ecrire.every(x => cartes.find(c => c._id === x.carteId).nomFr === undefined), true);
}

// ============ (B) ============
const clone = (cartes, sets = []) => ({ cartes, sets });
const cc = (famille, setId, localId, fr, en, extra = {}) => ({ famille, setId, localId, noms: { fr, en }, dex: [], cardmarket: [], ...extra });
const B = (carte, lignes, produits, c) => P.planifierB({ cartes: [carte], liens: lignes.map(l => ({ carteId: carte._id, ...l })), frDuProduit: frDe(produits), clone: c }).decisions[0];
const base = { _id: 11408, nomEn: 'Double Colorless Energy', nomFr: null, nomFrSource: 'cardmarket' };
const produitsB = [prod(3, 'Double Énergie Incolore'), prod(4, 'Double Colorless Energy')];

{
    // B1 : lien Cardmarket + nom anglais égal + fr du clone concordant avec l'un des noms en conflit
    const d = B(base, [{ idProduct: 3 }, { idProduct: 4 }], produitsB, clone([cc('data', 'base1', '96', 'Double Énergie Incolore', 'Double Colorless Energy', { cardmarket: [3] })]));
    egal('B1 décision', d.decision, 'remplir');
    egal('B1 nom', d.nomFr, 'Double Énergie Incolore');
    egal('B1 témoin', d.temoin, 'nom-en');
    egal('B1 les noms en conflit sont listés', d.conflits.slice().sort(), ['Double Colorless Energy', 'Double Énergie Incolore']);
    egal('B1 ancienne valeur journalisée : null', d.ancien, null);
    egal('B1 source', d.source, 'cardmarket+tcgdex');
}
{
    // B2 : le clone ne concorde avec aucun nom en conflit -> reste null
    const d = B(base, [{ idProduct: 3 }, { idProduct: 4 }], produitsB, clone([cc('data', 'base1', '96', 'Énergie Double Incolore', 'Double Colorless Energy', { cardmarket: [3] })]));
    egal('B2 sans concordance : reste null', [d.decision, d.raison], ['reste-null', 'aucune-concordance']);
}
{
    // B3 : lien NON prouvé (nom anglais différent, pas de set+numéro) : le fr du clone ne vaut rien même s'il concorde
    const d = B(base, [{ idProduct: 3, idExpansion: 7, numeroFiche: '96' }, { idProduct: 4 }], produitsB, clone([cc('data', 'x', '1', 'Double Énergie Incolore', 'Professor Elm\'s Training Method', { cardmarket: [3] })]));
    egal('B3 lien non prouvé : reste null', [d.decision, d.raison], ['reste-null', 'lien-non-prouve']);
}
{
    // B4 : deux cartes TCGdex pour un même identifiant Cardmarket : le lien ne vaut rien, même si l'une concorde et que son nom anglais est égal
    const d = B(base, [{ idProduct: 3 }, { idProduct: 4 }], produitsB, clone([
        cc('data', 'base1', '96', 'Double Énergie Incolore', 'Double Colorless Energy', { cardmarket: [3] }),
        cc('data', 'tk', '9', 'Autre', 'Another card', { cardmarket: [3] })]));
    egal('B4 deux cartes pour un même lien : reste null', [d.decision, d.raison], ['reste-null', 'lien-non-prouve']);
    egal('B4b ... et la raison fine du lien est gardée', d.liens?.[0]?.raison, 'lien-multiple');
}
{
    // B5 : témoin set + numéro (nom anglais absent du clone) accepté
    const c = clone([cc('data', 'base1', '96', 'Double Énergie Incolore', null, { cardmarket: [3] })], [{ id: 'base1', famille: 'data', cardmarket: 1234 }]);
    const d = B(base, [{ idProduct: 3, idExpansion: 1234, numeroFiche: '096' }, { idProduct: 4 }], produitsB, c);
    egal('B5 set+numéro prouve le lien', [d.decision, d.temoin], ['remplir', 'set+numero']);
    // ... mais pas si le numéro diffère
    const d2 = B(base, [{ idProduct: 3, idExpansion: 1234, numeroFiche: '97' }, { idProduct: 4 }], produitsB, c);
    egal('B5b set+numéro qui diffère : non prouvé', [d2.decision, d2.raison], ['reste-null', 'lien-non-prouve']);
}
{
    // B6 : le n° de Pokédex contredit -> refusé, même avec un nom anglais égal
    const c = clone([cc('data', 'base1', '96', 'Double Énergie Incolore', 'Double Colorless Energy', { cardmarket: [3], dex: [25] })]);
    const d = B({ ...base, ndex: [133] }, [{ idProduct: 3 }, { idProduct: 4 }], produitsB, c);
    egal('B6 dex contredit : reste null', [d.decision, d.raison], ['reste-null', 'lien-non-prouve']);
    egal('B6b raison fine', d.liens?.[0]?.raison, 'dex-contredit');
}
{
    // B7 : le fr du clone est le nom anglais (non traduit) : on n'écrit pas l'anglais comme du français
    const c = clone([cc('data', 'base1', '96', 'Double Colorless Energy', 'Double Colorless Energy', { cardmarket: [3] })]);
    const d = B(base, [{ idProduct: 3 }, { idProduct: 4 }], produitsB, c);
    egal('B7 clone non traduit : reste null', [d.decision, d.raison], ['reste-null', 'tcgdex-non-traduit']);
}
{
    // B8 : le clone n'a pas de fr
    const c = clone([cc('data', 'base1', '96', null, 'Double Colorless Energy', { cardmarket: [3] })]);
    egal('B8 clone sans fr : reste null', B(base, [{ idProduct: 3 }, { idProduct: 4 }], produitsB, c).raison, 'tcgdex-sans-fr');
    // B8b : aucun identifiant du clone
    egal('B8b identifiant absent du clone', B(base, [{ idProduct: 3 }, { idProduct: 4 }], produitsB, clone([])).raison, 'lien-non-prouve');
}
{
    // B9 : deux produits désignent deux cartes TCGdex aux fr différents : contradictoire
    const c = clone([cc('data', 'a', '1', 'Double Énergie Incolore', 'Double Colorless Energy', { cardmarket: [3] }), cc('data', 'b', '2', 'Énergie Double Incolore', 'Double Colorless Energy', { cardmarket: [4] })]);
    egal('B9 clone contradictoire : reste null', B(base, [{ idProduct: 3 }, { idProduct: 4 }], produitsB, c).raison, 'tcgdex-contradictoire');
}
{
    // B10 : la population de (B) est exactement « nomFr null ET nomFrSource cardmarket » ; une carte déjà nommée n'est JAMAIS touchée
    const cartes = [base, { ...base, _id: 2, nomFr: 'Déjà là' }, { ...base, _id: 3, nomFrSource: 'tcgdex' }, { ...base, _id: 4, nomFr: undefined }];
    const liens = cartes.flatMap(c => [{ carteId: c._id, idProduct: 3 }, { carteId: c._id, idProduct: 4 }]);
    const r = P.planifierB({ cartes, liens, frDuProduit: frDe(produitsB), clone: clone([cc('data', 'base1', '96', 'Double Énergie Incolore', 'Double Colorless Energy', { cardmarket: [3] })]) });
    egal('B10 seule la carte à null/cardmarket est examinée', r.decisions.map(d => d.carteId), [11408]);
    egal('B10b invariant : tout remplissage vise un null cardmarket', r.decisions.filter(d => d.decision === 'remplir').every(d => cartes.find(c => c._id === d.carteId).nomFr === null), true);
}
{
    // B11 : plus de conflit (les produits concordent désormais) : on ne touche à rien, on le dit
    // null PÉRIMÉ (les produits concordent désormais) : même règle, la seconde source tranche
    const d = B(base, [{ idProduct: 3 }], produitsB, clone([cc('data', 'base1', '96', 'Double Énergie Incolore', 'Double Colorless Energy', { cardmarket: [3] })]));
    egal('B11 null périmé + TCGdex concordant (lien prouvé) = nommé', [d.decision, d.nomFr, d.perime], ['remplir', 'Double Énergie Incolore', true]);
    const dn = B(base, [{ idProduct: 3 }], produitsB, clone([]));
    egal('B11a null périmé sans TCGdex = reste null', [dn.decision, dn.raison], ['reste-null', 'lien-non-prouve']);
    const dd = B(base, [{ idProduct: 3 }], produitsB, clone([cc('data', 'base1', '96', 'Autre nom', 'Double Colorless Energy', { cardmarket: [3] })]));
    egal('B11c null périmé, TCGdex discordant = reste null', [dd.decision, dd.raison], ['reste-null', 'aucune-concordance']);
    const dl = B(base, [{ idProduct: 3 }], produitsB, clone([cc('data', 'x', '1', 'Double Énergie Incolore', 'Autre carte', { cardmarket: [3] })]));
    egal('B11d null périmé, lien non prouvé = reste null', [dl.decision, dl.raison], ['reste-null', 'lien-non-prouve']);
    egal('B11e le témoin garde sa référence TCGdex (set, numéro)', d.refsTcgdex, ['data|base1|96']);
    const d0 = B(base, [], produitsB, clone([]));
    egal('B11b aucun produit à nomFr : reste null, raison dédiée', [d0.decision, d0.raison], ['reste-null', 'sans-produit-fr']);
}
{
    // B12 : forme retenue = la plus accentuée entre la forme Cardmarket et celle du clone, sans changer de nom
    const p = [prod(3, 'Double Energie Incolore'), prod(4, 'Double Colorless Energy')];
    const d = B(base, [{ idProduct: 3 }, { idProduct: 4 }], p, clone([cc('data', 'base1', '96', 'Double Énergie Incolore', 'Double Colorless Energy', { cardmarket: [3] })]));
    egal('B12 accents : la forme accentuée du clone gagne', d.nomFr, 'Double Énergie Incolore');
}

// ============ l'écriture ne part pas hors d'un lot ============
{
    const r = spawnSync(process.execPath, [path.join(__dirname, 'poser-noms-fr-fiches.js'), '--ecrire', '--attendu=A:1,B:1'], { encoding: 'utf8', env: { ...process.env, LOT_ADDITIF_PID: '' } });
    egal('E1 --ecrire hors lot-additif : refus (code 2)', r.status, 2);
    const r2 = spawnSync(process.execPath, [path.join(__dirname, 'poser-noms-fr-fiches.js'), '--inconnu'], { encoding: 'utf8' });
    egal('E2 argument inconnu : refus avant toute connexion (code 2)', r2.status, 2);
}

// ============ les opérations d'écriture : le filtre EXACT et le $set de chacune (mutants M1, M1b) ============
{
    const le = new Date('2026-11-01T00:00:00Z');
    const { opsA, opsB } = P.construireOps({
        ecrireA: [{ carteId: -7, nomFr: 'Léo' }, { carteId: -8, nomFr: null }],
        remplirB: [{ carteId: 11408, nomFr: 'Double Énergie Incolore', source: 'cardmarket+tcgdex' }], le });
    egal('O1 filtre (A) exact : _id + nomFr absent', opsA[0].updateOne.filter, { _id: -7, nomFr: { $exists: false } });
    egal('O2 $set (A) exact', opsA[0].updateOne.update, { $set: { nomFr: 'Léo', nomFrSource: 'cardmarket', nomFrLe: le } });
    egal('O3 (A) conflit : null écrit, même filtre', [opsA[1].updateOne.filter, opsA[1].updateOne.update.$set.nomFr], [{ _id: -8, nomFr: { $exists: false } }, null]);
    egal('O4 filtre (B) exact : _id + nomFr null + nomFrSource cardmarket', opsB[0].updateOne.filter, { _id: 11408, nomFr: { $type: 'null' }, nomFrSource: 'cardmarket' });
    egal('O5 $set (B) exact', opsB[0].updateOne.update, { $set: { nomFr: 'Double Énergie Incolore', nomFrSource: 'cardmarket+tcgdex', nomFrLe: le } });
    egal('O6 une opération par carte, rien d\'autre que updateOne', [opsA.length, opsB.length, [...opsA, ...opsB].every(o => Object.keys(o).join() === 'updateOne')], [2, 1, true]);
}

// ============ --attendu : les comptes ont bougé -> code 3, SANS connexion d'écriture (lectures seules ; banc long, --reel) ============
if (process.argv.includes('--reel')) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'poser-noms-fr-fiches.js'), '--ecrire', '--attendu=A:0,B:0'], { encoding: 'utf8', env: { ...process.env, LOT_ADDITIF_PID: '1' }, timeout: 600000 });
    egal('R1 --attendu faux : code 3', r.status, 3);
    egal('R2 ... message « Rien n\'a été écrit »', /Rien n'a été écrit/.test(r.stderr), true);
    egal('R3 ... aucune connexion d\'écriture ouverte (pas de ligne « cible » de garde.js)', /cible : "cartes"/.test(r.stdout + r.stderr), false);
}

console.log(`${ko ? '❌' : '✅'} test-poser-noms-fr-fiches : ${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
