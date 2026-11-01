// Banc des NIVEAUX ajoutes a collecte-cartes/plan-noms-fr-379.js (lot des 210) : liens par cles (A/B/C) et nom d'ESPECE.
// Sans l'option `niveaux`, le comportement du lot 379 ne change pas. Aucune base, aucun reseau.
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };
const M = require('./collecte-cartes/plan-noms-fr-379');
const E = require('./collecte-cartes/lien-par-cles-210');

const T = (setId, localId, en, fr, extra = {}) => ({ famille: 'data', setId, localId, noms: { en, fr }, dex: [], cardmarket: [], ...extra });
const clone = {
    sets: [{ famille: 'data', id: 'ex13', noms: { en: 'Holon Phantoms' }, cardmarket: 1551 }, { famille: 'data', id: 'sv9', noms: { en: 'Autre' }, cardmarket: 9 }],
    cartes: [
        T('ex13', '80', 'Poochyena', 'Medhyena', { cardmarket: [777] }),
        T('sv9', '1', 'Fletchling', 'Passerouge'), T('sv9', '2', 'Talonflame ex', 'Flambusard ex'),
        T('sv9', '3', 'Malamar', 'Sepiatroce'), T('sv9', '4', 'Pinsir-GX', 'Scarabrute-GX'),
        T('sv9', '5', 'Pinsir', 'Scarabrute'),
        T('sv9', '6', 'Ditto', 'Metamorph'), T('sv9', '7', 'Ditto', 'Metamorph Alpha'),   // espece AMBIGUE
        T('sv9', '8', 'Meowth', 'Miaouss'), T('sv9', '9', 'Alolan Meowth', "Miaouss d'Alola"),
    ],
};
const ligne = (carteId, idProduct, extra = {}) => ({ carteId, idProduct, ...extra });
const cartes = [
    { _id: 10, nomEn: 'Poochyena', categorie: 'pokemon', impressions: [] },                      // lien par cle B (id absent du clone)
    { _id: 11, nomEn: 'Fletchling', categorie: 'pokemon', impressions: [] },                     // espece
    { _id: 12, nomEn: 'Mega Malamar ex', categorie: 'pokemon', impressions: [] },                // espece composee Mega + ex
    { _id: 13, nomEn: 'Pinsir-GX', categorie: 'pokemon', impressions: [] },                      // espece composee, separateur
    { _id: 14, nomEn: 'Ditto', categorie: 'pokemon', impressions: [] },                          // espece ambigue
    { _id: 15, nomEn: "Erika's Vileplume ex", categorie: 'pokemon', impressions: [] },           // proprietaire
    { _id: 16, nomEn: 'Alolan Meowth', categorie: 'pokemon', impressions: [] },                  // forme regionale : non composee
    { _id: 17, nomEn: 'Poochyena', categorie: 'dresseur', impressions: [] },                     // un Dresseur n'a pas d'espece
    { _id: 18, nomEn: 'Poochyena', categorie: 'pokemon', impressions: [] },                      // l'id designe une autre carte ET la cle une troisieme
];
const liens = [
    ligne(10, 5001, { idExpansion: 1551, numeroFiche: '80' }),
    ligne(17, 5002, { idExpansion: 1551, numeroFiche: '80' }),
    ligne(18, 777, { idExpansion: 1551, numeroFiche: '81' }),                                    // id 777 -> ex13|80 (Poochyena) : le nom concorde ; la cle B vise 81 (inexistant)
];

// sans niveaux : comportement du lot 379
let P = M.planifierCandidats({ cartes, liens, clone });
egal('N0 sans niveaux : la carte 10 (id absent du clone) reste sans nom', P.sansNom.find(x => x.carteId === 10).raison, 'lien-non-prouve');
egal('N0b sans niveaux : la 11 (aucune ligne) reste sans ligne produit', P.sansNom.find(x => x.carteId === 11).raison, 'sans-ligne-produit');

P = M.planifierCandidats({ cartes, liens, clone, niveaux: ['cles', 'espece'] });
const c = id => P.candidats.find(x => x.carteId === id);
const s = id => P.sansNom.find(x => x.carteId === id);
egal('N1 lien par cle B', [c(10).nomTcgdex, c(10).temoin, c(10).lien], ['Medhyena', 'cles:B', 'cles:B']);
egal('N2 espece : le nom vient des AUTRES cartes TCGdex de meme nom anglais', [c(11).nomTcgdex, c(11).temoin, c(11).lien], ['Passerouge', 'espece', 'espece']);
egal('N3 espece composee : Mega + ex', c(12).nomTcgdex, 'Méga-Sepiatroce ex');
egal('N4 espece composee : suffixe en casse officielle', c(13).nomTcgdex, 'Scarabrute GX');
egal('N5 espece ambigue : refus nomme', s(14).raison, 'espece-ambigue');
egal('N6 proprietaire : refus', s(15).raison, 'espece-proprietaire');
egal('N7 forme regionale : non composee', s(16).raison, 'espece-forme-regionale');
egal('N8 un Dresseur ne passe par aucun niveau neuf', s(17).raison, 'lien-non-prouve');
egal('N9 la carte 18 (id -> ex13|80, cle B -> rien) garde son lien par l\'id : candidate comme avant', c(18) && c(18).temoin, 'nom-en');

// confirmer sur un candidat d'espece : meme controle par la page Poképédia
const page = { titre: 'Sepiatroce', anglais: 'Malamar' };
egal('N10 confirmer : Méga-Sepiatroce ex', M.confirmer(c(12), page).nomFr, 'Méga-Sepiatroce ex');
egal('N11 confirmer : le separateur suit le nom anglais (Pinsir-GX)', M.confirmer(c(13), { titre: 'Scarabrute', anglais: 'Pinsir' }).nomFr, 'Scarabrute-GX');
egal('N12 confirmer : la page contredit -> sans nom', M.confirmer(c(12), { titre: 'Autre', anglais: 'Malamar' }).decision, 'sans-nom');
egal('N13 confirmer reporte le lien', M.confirmer(c(11), { titre: 'Passerouge', anglais: 'Fletchling' }).lien, 'espece');

// les espèces à lire : celles des candidats neufs aussi
egal('N14 especesAChercher inclut les especes neuves', M.especesAChercher(P.candidats).sort(), ['Medhyena', 'Passerouge', 'Scarabrute', 'Sepiatroce']);

// un conflit entre l'id et les cles : refus
const liensConflit = [ligne(19, 777, { idExpansion: 9, numeroFiche: '1' })];                    // id 777 -> ex13|80 ; cle B -> sv9|1 (Fletchling)
P = M.planifierCandidats({ cartes: [{ _id: 19, nomEn: 'Fletchling', categorie: 'pokemon', impressions: [] }], liens: liensConflit, clone, niveaux: ['cles'] });
egal('N15 id et cle designent deux cartes : refus', [P.candidats.length, P.sansNom[0].raison], [0, 'cles-contredisent-l-id']);

// le nom d'une carte TCGdex qui contredit l'ESPECE (faute de saisie chez la source, comme « Gradhyena ex » face a « Grahyèna ») : l'espece l'emporte
const cloneFaute = { sets: clone.sets, cartes: [...clone.cartes, T('sv9', '20', 'Mightyena', 'Grahyèna'), T('sv9', '21', 'Mightyena', 'Grahyena'), T('ex13', '101', 'Mightyena ex', 'Gradhyena ex', { cardmarket: [888] })] };
P = M.planifierCandidats({ cartes: [{ _id: 20, nomEn: 'Mightyena ex', categorie: 'pokemon', impressions: [] }], liens: [ligne(20, 888)], clone: cloneFaute, niveaux: ['espece'] });
egal('N19 faute de saisie TCGdex : le nom de l\'espece (Grahyèna ex), l\'ecart est garde', [P.candidats[0].nomTcgdex, P.candidats[0].lien, P.candidats[0].ecartLien], ['Grahyèna ex', 'espece', 'Gradhyena ex']);
P = M.planifierCandidats({ cartes: [{ _id: 20, nomEn: 'Mightyena ex', categorie: 'pokemon', impressions: [] }], liens: [ligne(20, 888)], clone: cloneFaute });
egal('N20 sans le niveau espece : le nom de la carte TCGdex, comme avant', [P.candidats[0].nomTcgdex, P.candidats[0].lien], ['Gradhyena ex', undefined]);

// meme espece, forme plus accentuee ailleurs (Medhyena / Medhyèna) : la forme accentuee, que la page officielle porte
const cloneAccent = { sets: clone.sets, cartes: [...clone.cartes, T('sv9', '30', 'Poochyena', 'Medhyèna')] };
P = M.planifierCandidats({ cartes: [{ _id: 21, nomEn: 'Poochyena', categorie: 'pokemon', impressions: [] }], liens: [ligne(21, 777)], clone: cloneAccent, niveaux: ['espece'] });
egal('N21 forme accentuee de l\'espece, lien conserve', [P.candidats[0].nomTcgdex, P.candidats[0].temoin, P.candidats[0].lien], ['Medhyèna', 'nom-en', undefined]);

// cartes a proprietaire : la page de CARTE (titre = nom TCGdex, nom anglais = le notre sans le suffixe, numero = celui de la carte TCGdex liee)
const texteCarte = (titre, anglais, num) => `${titre} — Poképédia\n\nAller au contenu\n\nNom japonais\nエリカ\n\nNom anglais\n${anglais}\n\nExtension\nX\n\nNumérotation\n${num}\n`;
const pc = M.lirePageCarte(texteCarte("Rafflesia-ex d'Erika (Méga-Évolution Héros Transcendants 003)", "Erika's Vileplume", '003/217'));
egal('P1 lirePageCarte', pc, { titre: "Rafflesia-ex d'Erika (Méga-Évolution Héros Transcendants 003)", anglais: "Erika's Vileplume", numero: '003/217' });
const candP = { carteId: 30, nomEn: "Erika's Vileplume ex", nomTcgdex: "Rafflesia-ex d'Erika", temoin: 'nom-en', refsTcgdex: ['data|me02.5|003'] };
let rc = M.confirmerCarte(candP, pc);
egal('P2 confirmee : nom officiel de la page, lien ecrit', [rc.decision, rc.nomFr, rc.paire, rc.lien], ['nommer', "Rafflesia-ex d'Erika", 'tcgdex+pokepedia', 'page-carte']);
egal('P3 le nom anglais de la page differe : refus', M.confirmerCarte(candP, { ...pc, anglais: "Erika's Gloom" }).raison, 'sources-contradictoires');
egal('P4 le numero de la page differe de celui de la carte TCGdex : refus', M.confirmerCarte(candP, { ...pc, numero: '004/217' }).raison, 'sources-contradictoires');
egal('P5 le titre differe du nom TCGdex : refus', M.confirmerCarte({ ...candP, nomTcgdex: "Rafflesia d'Erika" }, pc).raison, 'sources-contradictoires');
egal('P6 le suffixe differe (notre nom sans ex) : refus', M.confirmerCarte({ ...candP, nomEn: "Erika's Vileplume" }, pc).raison, 'sources-contradictoires');
egal('P7 sans page : refus nomme', M.confirmerCarte(candP, null).raison, 'page-carte-absente');
egal('P8 sans carte TCGdex liee (rien a rapprocher du numero) : refus', M.confirmerCarte({ ...candP, refsTcgdex: [] }, pc).raison, 'sources-contradictoires');

// ecriture : le lien est ecrit, sans nom de source public
const ops = M.construireOps({ nommer: [{ carteId: 11, nomFr: 'Passerouge', paire: 'tcgdex+pokepedia', lien: 'espece' }, { carteId: 10, nomFr: 'Medhyena', paire: 'tcgdex+pokepedia' }], le: new Date(0) });
egal('N16 $set avec nomFrLien quand il existe', ops.map(o => Object.keys(o.updateOne.update.$set)), [['nomFr', 'nomFrSource', 'nomFrLe', 'nomFrLien'], ['nomFr', 'nomFrSource', 'nomFrLe']]);
egal('N17 le filtre reste $exists:false', ops.map(o => o.updateOne.filter), [{ _id: 11, nomFr: { $exists: false } }, { _id: 10, nomFr: { $exists: false } }]);
egal('N18 niveau inconnu : lève', (() => { try { M.planifierCandidats({ cartes: [], liens: [], clone, niveaux: ['bidule'] }); return 'ok'; } catch (e) { return 'leve'; } })(), 'leve');

console.log(`${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
