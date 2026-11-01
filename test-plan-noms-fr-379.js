// Banc de plan-noms-fr-379.js (aucune base, aucun réseau) : les 379 cartes positives SANS champ nomFr reçoivent un nom si DEUX sources concordent
// (clone TCGdex + page Poképédia lue par la porte) ; sinon elles restent sans nom. On fait dire NON sur des états fabriqués.
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };
const P = require('./collecte-cartes/plan-noms-fr-379');

// ---- décomposition d'un nom (anglais / français) ----
egal('D1 en simple', P.decomposerEn('Corphish'), { base: 'Corphish', suffixe: null, mega: false, region: null, proprietaire: false });
egal('D2 en ex', P.decomposerEn('Crawdaunt ex').suffixe, 'ex');
egal('D3 en GX avec tiret', P.decomposerEn('Pinsir-GX'), { base: 'Pinsir', suffixe: 'gx', mega: false, region: null, proprietaire: false });
egal('D4 en région', P.decomposerEn('Galarian Meowth'), { base: 'Meowth', suffixe: null, mega: false, region: 'galar', proprietaire: false });
egal('D5 en méga ex', P.decomposerEn('Mega Audino ex'), { base: 'Audino', suffixe: 'ex', mega: true, region: null, proprietaire: false });
egal('D6 en propriétaire', P.decomposerEn("Erika's Vileplume ex").proprietaire, true);
egal('D7 fr simple', P.decomposerFr('Zarbi'), { base: 'Zarbi', suffixe: null, mega: false, region: null, proprietaire: false });
egal('D8 fr ex avec tiret', P.decomposerFr('Colhomard-ex').base, 'Colhomard');
egal('D9 fr ex avec espace', P.decomposerFr('Colhomard ex').suffixe, 'ex');
egal('D10 fr région + ex', P.decomposerFr('Terraiste de Paldea-ex'), { base: 'Terraiste', suffixe: 'ex', mega: false, region: 'paldea', proprietaire: false });
egal('D11 fr méga', P.decomposerFr('Méga-Nanméouïe-ex'), { base: 'Nanméouïe', suffixe: 'ex', mega: true, region: null, proprietaire: false });
egal('D12 fr propriétaire', P.decomposerFr("Rafflesia-ex d'Erika").proprietaire, true);
egal('D13 fr région Alola', P.decomposerFr("Miaouss d'Alola").region, 'alola');
egal('D14 fr Mr. Mime', P.decomposerFr('M. Mime').base, 'M. Mime');

// ---- page Poképédia ----
const PAGE = (titre, en) => `${titre} — Poképédia\n\nMenu\n\nNom anglais ${en}\n\nBla`;
egal('L1 lecture titre + anglais', P.lirePage(PAGE('Écrapince', 'Corphish')), { titre: 'Écrapince', anglais: 'Corphish' });
egal('L2 page sans nom anglais', P.lirePage('Truc — Poképédia\n\nrien'), { titre: 'Truc', anglais: null });
egal('L3 texte vide', P.lirePage(''), null);
egal('L4 nom de fichier stable', P.fichierPage('Écrapince'), 'ecrapince.txt');
egal('L5 nom de fichier ♀', P.fichierPage('Nidoran♀'), 'nidoran-f.txt');
egal('L6 url', P.urlPage('M. Mime'), 'https://www.pokepedia.fr/M._Mime');

// ---- confirmation ----
const cand = (o = {}) => ({ carteId: 33758, nomEn: 'Corphish', nomTcgdex: 'Ecrapince', temoin: 'nom-en', ...o });
let d = P.confirmer(cand(), P.lirePage(PAGE('Écrapince', 'Corphish')));
egal('C1 concordance : nommée', [d.decision, d.nomFr, d.paire], ['nommer', 'Écrapince', 'tcgdex+pokepedia']);
d = P.confirmer(cand({ nomEn: 'Crawdaunt ex', nomTcgdex: 'Colhomard ex' }), P.lirePage(PAGE('Colhomard', 'Crawdaunt')));
egal('C2 suffixe ex conservé', [d.decision, d.nomFr], ['nommer', 'Colhomard ex']);
d = P.confirmer(cand({ nomEn: 'Pinsir-GX', nomTcgdex: 'Scarabrute-GX' }), P.lirePage(PAGE('Scarabrute', 'Pinsir')));
egal('C3 GX conservé', d.nomFr, 'Scarabrute-GX');
d = P.confirmer(cand({ nomEn: 'Galarian Meowth', nomTcgdex: 'Miaouss de Galar' }), P.lirePage(PAGE('Miaouss', 'Meowth')));
egal('C4 région concordante', [d.decision, d.nomFr], ['nommer', 'Miaouss de Galar']);
d = P.confirmer(cand({ nomEn: 'Alolan Meowth', nomTcgdex: 'Miaouss de Galar' }), P.lirePage(PAGE('Miaouss', 'Meowth')));
egal('C5 région contredite : sans nom', [d.decision, d.raison], ['sans-nom', 'forme-contredite']);
d = P.confirmer(cand({ nomEn: 'Mewtwo', nomTcgdex: 'Ecrapince' }), P.lirePage(PAGE('Écrapince', 'Corphish')));
egal('C6 Poképédia contredit (autre nom anglais) : sans nom, contradiction listée', [d.decision, d.raison], ['sans-nom', 'sources-contradictoires']);
d = P.confirmer(cand(), P.lirePage('Autre — Poképédia\n\nNom anglais Corphish'));
egal('C7 titre de page différent du nom TCGdex : contradiction', [d.decision, d.raison], ['sans-nom', 'sources-contradictoires']);
d = P.confirmer(cand(), null);
egal('C8 page absente : une seule source', [d.decision, d.raison], ['sans-nom', 'seconde-source-absente']);
d = P.confirmer(cand(), P.lirePage('Écrapince — Poképédia\n\nsans nom anglais'));
egal('C9 page sans nom anglais : pas de confirmation', [d.decision, d.raison], ['sans-nom', 'seconde-source-absente']);
d = P.confirmer(cand({ nomEn: "Erika's Vileplume ex", nomTcgdex: "Rafflesia-ex d'Erika" }), P.lirePage(PAGE('Rafflesia', 'Vileplume')));
egal('C10 propriétaire : non vérifiable', [d.decision, d.raison], ['sans-nom', 'proprietaire-non-verifiable']);
d = P.confirmer(cand({ nomEn: 'Pikachu', nomTcgdex: 'Pikachu' }), P.lirePage(PAGE('Pikachu', 'Pikachu')));
egal('C11 nom identique à l\'anglais confirmé par la page : nommée, marquée', [d.decision, d.nomFr, d.identiqueAnglais], ['nommer', 'Pikachu', true]);
d = P.confirmer(cand({ nomEn: 'Nidoran♀', nomTcgdex: 'Nidoran♀' }), P.lirePage(PAGE('Nidoran♀', 'Nidoran♂')));
egal('C12 genre contredit : sans nom', d.decision, 'sans-nom');
d = P.confirmer(cand({ nomEn: null }), P.lirePage(PAGE('Écrapince', 'Corphish')));
egal('C13 nomEn absent : sans nom', [d.decision, d.raison], ['sans-nom', 'nom-en-absent']);
d = P.confirmer(cand({ nomEn: 'Mr. Mime', nomTcgdex: 'M. Mime' }), P.lirePage(PAGE('M. Mime', 'Mr. Mime')));
egal('C14 Mr. Mime', d.nomFr, 'M. Mime');

d = P.confirmer(cand({ nomEn: 'Registeel ex', nomTcgdex: 'Registeel-ex' }), P.lirePage(PAGE('Registeel', 'Registeel')));
egal('C15 séparateur du suffixe aligné sur le nom anglais (espace)', d.nomFr, 'Registeel ex');
d = P.confirmer(cand({ nomEn: 'Paldean Clodsire ex', nomTcgdex: 'Terraiste de Paldea-ex' }), P.lirePage(PAGE('Terraiste', 'Clodsire')));
egal('C16 région + ex : espace', d.nomFr, 'Terraiste de Paldea ex');
d = P.confirmer(cand({ nomEn: 'Wigglytuff-GX', nomTcgdex: 'Grodoudou GX' }), P.lirePage(PAGE('Grodoudou', 'Wigglytuff')));
egal('C17 séparateur tiret du nom anglais respecté', d.nomFr, 'Grodoudou-GX');

// ---- candidats (lien prouvé par prouverLien/indexClone de la production) ----
const clone = { cartes: [
    { famille: 'data', setId: 'ex6', localId: '10', noms: { fr: 'Ecrapince', en: 'Corphish' }, dex: [341], cardmarket: [111] },
    { famille: 'data', setId: 'ex6', localId: '11', noms: { en: 'Zorua' }, dex: [], cardmarket: [222] },
    { famille: 'data', setId: 'a', localId: '1', noms: { fr: 'X', en: 'Autre' }, dex: [], cardmarket: [333] },
    { famille: 'data', setId: 'a', localId: '2', noms: { fr: 'Y', en: 'Doublon' }, dex: [], cardmarket: [444] },
    { famille: 'data', setId: 'a', localId: '3', noms: { fr: 'Z', en: 'Doublon' }, dex: [], cardmarket: [444] },
], sets: [] };
const cartes = [
    { _id: 1, nomEn: 'Corphish' },                     // lien prouvé par le nom anglais, fr présent
    { _id: 2, nomEn: 'Zorua' },                        // lien prouvé mais TCGdex sans fr
    { _id: 3, nomEn: 'Nom différent' },                // lien non prouvé
    { _id: 4, nomEn: 'Aucun lien' },                   // aucune ligne produit
    { _id: 5, nomEn: 'Doublon' },                      // lien multiple
    { _id: 6, nomEn: 'Corphish', nomFr: 'Déjà' },      // déjà nommée : jamais dans le plan
    { _id: -7, nomEn: 'Corphish' },                    // négative : hors lot
    { _id: 8, nomEn: 'Corphish', nomFr: null },        // nomFr null : hors lot
];
const liens = [{ carteId: 1, idProduct: 111 }, { carteId: 2, idProduct: 222 }, { carteId: 3, idProduct: 333 }, { carteId: 5, idProduct: 444 },
    { carteId: 6, idProduct: 111 }, { carteId: -7, idProduct: 111 }, { carteId: 8, idProduct: 111 }];
const r = P.planifierCandidats({ cartes, liens, clone });
egal('P1 un seul candidat', r.candidats.map(c => [c.carteId, c.nomTcgdex, c.temoin]), [[1, 'Ecrapince', 'nom-en']]);
egal('P2 raisons des autres', Object.fromEntries(r.sansNom.map(x => [x.carteId, x.raison])), { 2: 'tcgdex-sans-fr', 3: 'lien-non-prouve', 4: 'sans-ligne-produit', 5: 'lien-non-prouve' });
egal('P3 population = positives SANS champ', r.population, 5);
egal('P4 espèces à lire', P.especesAChercher(r.candidats), ['Ecrapince']);
const clone2 = { cartes: [
    { famille: 'data', setId: 'a', localId: '1', noms: { fr: 'Alpha', en: 'Uno' }, dex: [], cardmarket: [501] },
    { famille: 'data', setId: 'a', localId: '2', noms: { fr: 'Beta', en: 'Uno' }, dex: [], cardmarket: [502] },
], sets: [] };
const r2 = P.planifierCandidats({ cartes: [{ _id: 9, nomEn: 'Uno' }], liens: [{ carteId: 9, idProduct: 501 }, { carteId: 9, idProduct: 502 }], clone: clone2 });
egal('P5 deux fr TCGdex différents : contradictoire, listé', [r2.candidats.length, r2.sansNom[0].raison, r2.sansNom[0].detail], [0, 'tcgdex-contradictoire', 'Alpha / Beta']);

// ---- ops d'écriture : le filtre s'écrit par ce qu'il AUTORISE ----
const ops = P.construireOps({ nommer: [{ carteId: 33758, nomFr: 'Écrapince', paire: 'tcgdex+pokepedia' }], le: new Date('2026-11-01T00:00:00Z') });
egal('O1 filtre exact', ops[0].updateOne.filter, { _id: 33758, nomFr: { $exists: false } });
egal('O2 $set exact', ops[0].updateOne.update, { $set: { nomFr: 'Écrapince', nomFrSource: 'tcgdex+pokepedia', nomFrLe: new Date('2026-11-01T00:00:00Z') } });
let leve = false; try { P.construireOps({ nommer: [{ carteId: -3, nomFr: 'X', paire: 'tcgdex+pokepedia' }], le: new Date() }); } catch { leve = true; }
egal('O3 un _id négatif est refusé', leve, true);
leve = false; try { P.construireOps({ nommer: [{ carteId: 3, nomFr: '', paire: 'tcgdex+pokepedia' }], le: new Date() }); } catch { leve = true; }
egal('O4 un nom vide est refusé', leve, true);
leve = false; try { P.construireOps({ nommer: [{ carteId: 3, nomFr: 'X', paire: 'tcgdex' }], le: new Date() }); } catch { leve = true; }
egal('O5 une seule source est refusée', leve, true);

console.log(`${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
