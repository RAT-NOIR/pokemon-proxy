'use strict';
// LOT TAMPONS (C) — les fonctions PURES de la mesure des marques (le relevé du testeur, la comparaison du type lu, l'issue simulée de la chaîne, le faux au pire cas). Aucun réseau, aucune base.
const H = require('./_harnais');
const M = require('../mesures/mesurer-marques-tampon');

const L = (lecture, marques = [], essais = []) => ({ lecture, marques, essais });
const S = (...m) => L('marques', m, [{ marques: m }, { marques: m }]);

(async () => {
    H.v('1a. le type du relevé -> ce qu\'on en attend (ensemble complet, ou « Autre » : ensemble inconnu)', ['Staff', 'Staff + Prerelease', 'Prize Pack (Play! Pokémon)', 'Staff + Autre', 'Autre'].map(t => M.typeDuReleve(t)),
        [{ exact: ['staff'] }, { exact: ['staff', 'prerelease'] }, { exact: ['play-pokemon'] }, { exact: null, minimum: ['staff'], autre: true }, { exact: null, minimum: [], autre: true }]);
    H.v('1b. un type inconnu (ou une valeur de Object.prototype) : null — jamais deviné', [M.typeDuReleve('Jumbo'), M.typeDuReleve('toString'), M.typeDuReleve(undefined)], [null, null, null]);

    const att = M.typeDuReleve('Staff + Prerelease'), autre = M.typeDuReleve('Autre'), staffAutre = M.typeDuReleve('Staff + Autre');
    H.v('2a. relevé à ensemble complet : juste / sous-ensemble / autre ensemble / non lu', [M.comparerType(att, S('staff', 'prerelease')), M.comparerType(att, S('staff')), M.comparerType(att, S('league')), M.comparerType(att, S('staff', 'prerelease', 'league')), M.comparerType(att, L('aucune')), M.comparerType(att, L('autre')), M.comparerType(att, L('desaccord'))],
        ['juste', 'sous-ensemble', 'autre-ensemble', 'autre-ensemble', 'non-lu', 'non-lu', 'non-lu']);
    H.v('2b. relevé « Autre » : `autre` lu = conforme ; des marques lues = à juger (jamais tranché d\'ici) ; rien = non lu', [M.comparerType(autre, L('autre')), M.comparerType(autre, S('kfc')), M.comparerType(autre, L('aucune')), M.comparerType(autre, L('incertain'))], ['conforme-autre', 'a-juger', 'non-lu', 'non-lu']);
    H.v('2c. relevé « Staff + Autre » : le minimum (staff) doit se lire ; sinon autre ensemble', [M.comparerType(staffAutre, S('staff', 'kfc')), M.comparerType(staffAutre, S('league')), M.comparerType(staffAutre, L('autre'))], ['a-juger', 'autre-ensemble', 'conforme-autre']);
    H.v('2d. sans relevé : « sans-relevé »', M.comparerType(null, S('staff')), 'sans-relevé');

    H.v('3. détection : vue = le premier essai a lu quelque chose ; consensus = marques ou « autre » lus deux fois', [M.detection(S('staff')), M.detection(L('autre', [], [{ autre: true }])), M.detection(L('desaccord', [], [{ marques: ['staff'] }, { marques: [] }])), M.detection(L('aucune', [], [{ marques: [] }])), M.detection(L('incertain', [], ['incertain'])), M.detection(null)],
        [{ vu: true, consensus: true }, { vu: true, consensus: true }, { vu: true, consensus: false }, { vu: false, consensus: false }, { vu: false, consensus: false }, { vu: false, consensus: false }]);

    const base = { verite: 11, identifie: null, attendu: att };
    H.v('4a. issue : une question de DEUX produits dont le bon, ensemble complet lu en consensus = le sien : sûr juste GAGNÉ PAR LA RÈGLE', M.issueDeLaChaine({ ...base, statut: 'a-trancher', choix: [10, 11], lecture: S('staff', 'prerelease') }), { issue: 'sur-juste-regle', declenchable: true, regle: true });
    H.v('4b. … un ensemble lu qui n\'est pas le sien, ou rien lu : proposé (la question reste, avec la bonne carte)', [M.issueDeLaChaine({ ...base, statut: 'a-trancher', choix: [10, 11], lecture: S('staff') }).issue, M.issueDeLaChaine({ ...base, statut: 'a-trancher', choix: [10, 11], lecture: L('aucune') }).issue], ['propose', 'propose']);
    H.v('4c. une question à 3 : la règle n\'est pas consultée (proposé, non déclenchable) ; la bonne carte absente : question sans la bonne carte ; introuvable : idem', [M.issueDeLaChaine({ ...base, statut: 'a-trancher', choix: [9, 10, 11], lecture: S('staff', 'prerelease') }), M.issueDeLaChaine({ ...base, statut: 'a-trancher', choix: [9, 10], lecture: S('staff', 'prerelease') }).issue, M.issueDeLaChaine({ ...base, statut: 'introuvable', choix: null, lecture: S('staff', 'prerelease') }).issue],
        [{ issue: 'propose', declenchable: false, regle: false }, 'question-sans-la-bonne-carte', 'question-sans-la-bonne-carte']);
    H.v('4d. relevé « Autre » (ensemble inconnu) : la règle ne se déclenche jamais, même avec des marques lues', M.issueDeLaChaine({ verite: 11, identifie: null, attendu: autre, statut: 'a-trancher', choix: [10, 11], lecture: S('kfc') }), { issue: 'propose', declenchable: false, regle: false });
    H.v('4e. déjà identifiée par la chaîne : sûr juste (chaîne) si c\'est le bon, faux (chaîne) sinon — la règle n\'y est pour rien', [M.issueDeLaChaine({ ...base, statut: 'identifiee', choix: null, identifie: 11, lecture: S('staff') }), M.issueDeLaChaine({ ...base, statut: 'identifiee', choix: null, identifie: 10, lecture: S('staff') }).issue], [{ issue: 'sur-juste-chaine', declenchable: false, regle: false }, 'faux-chaine']);

    H.v('5a. faux au pire cas AVEC tampon : un consensus qui n\'est pas l\'ensemble du relevé (sous-ensemble, autre) ; juste, non lu, « Autre » : non', [M.fauxAvecTampon(att, S('staff')), M.fauxAvecTampon(att, S('league')), M.fauxAvecTampon(att, S('staff', 'prerelease')), M.fauxAvecTampon(att, L('aucune')), M.fauxAvecTampon(autre, S('kfc'))], [true, true, false, false, false]);
    H.v('5b. faux positif SANS tampon : un consensus NON VIDE de marques seulement (autre, aucune, incertain, désaccord : une question, pas un faux)', [M.fauxPositif(S('staff')), M.fauxPositif(L('autre')), M.fauxPositif(L('aucune')), M.fauxPositif(L('incertain')), M.fauxPositif(L('desaccord')), M.fauxPositif(null)], [true, false, false, false, false, false]);

    const r = (o) => ({ verite: 1, type: 'Staff', attendu: M.typeDuReleve('Staff'), lecture: S('staff'), issue: { issue: 'sur-juste-regle', declenchable: true, regle: true }, aPart: null, ...o });
    const b = M.bilanReleve([r({}), r({ lecture: L('aucune'), issue: { issue: 'propose', declenchable: true, regle: false } }), r({ lecture: S('league'), issue: { issue: 'propose', declenchable: true, regle: false } }), r({ type: 'Autre', attendu: autre, lecture: L('autre', [], [{ autre: true }]), issue: { issue: 'question-sans-la-bonne-carte', declenchable: false, regle: false } }), r({ aPart: 'conflit-archive-normale' })]);
    H.v('6. le bilan : les cartes À PART sont comptées à part et ne sont ni justes ni fausses ; le faux au pire cas compte le consensus d\'un autre ensemble', [b.cartes, b.aPart, b.evaluees, b.typesExacts.cartes, b.typesExacts.justes, b.typesExacts.nonLus, b.typesExacts.autreEnsemble, b.typesAutre.conformes, b.issues.surJusteRegle, b.issues.proposes, b.issues.questionsSansLaBonneCarte, b.fauxPireCas],
        [5, 1, 4, 3, 1, 1, 1, 1, 1, 2, 1, 1]);
    H.bilan();
})().catch(x => { console.error(x); process.exitCode = 1; });
