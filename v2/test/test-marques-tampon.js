'use strict';
// LOT TAMPONS — la liste FERMÉE des marques et la forme des jetons de variante. Pur : aucune base, aucun réseau.
const H = require('./_harnais');
const M = require('../identifier/marques-tampon');

(async () => {
    H.v('1a. la liste fermée : 16 marques, dans l\'ordre du catalogue', M.MARQUES, ['staff', 'prerelease', 'league', 'championship', 'toys-r-us', 'gamestop', 'kfc', 'indomilk', 'professor', 'cosmo', 'snowflake', 'play-pokemon', 'place-1', 'place-2', 'place-3', 'place-4']);
    H.v('1b. la liste est gelée (on ne l\'élargit pas à l\'exécution)', [Object.isFrozen(M.MARQUES), Object.isFrozen(M.FORMES_ANCIENNES)], [true, true]);

    const t = v => { const r = M.lireVariante(v); return r === null ? null : r.type === 'marques' ? r.jeton : r.type; };
    H.v('2a. les jetons simples : normale, jumbo, chaque marque', ['normale', 'jumbo', 'staff', 'place-4', 'toys-r-us', 'play-pokemon'].map(t), ['normale', 'jumbo', 'staff', 'place-4', 'toys-r-us', 'play-pokemon']);
    H.v('2b. les ensembles canoniques, joints par « + » dans l\'ordre de la liste', ['staff+prerelease', 'staff+championship', 'league+place-2'].map(t), ['staff+prerelease', 'staff+championship', 'league+place-2']);
    H.v('2c. un autre ordre, un doublon, un espace, une casse, un jeton inconnu, une marque inconnue dans un ensemble : null (jamais corrigé en silence)',
        ['prerelease+staff', 'staff+staff', 'staff + prerelease', 'Staff', 'STAFF', 'autre', 'staff+inconnue', 'staff+', '+staff', 'staff++prerelease', 'jumbo+staff', 'normale+staff', 'staff+normale', '', ' ', 'staff-prerelease'].map(t),
        Array(16).fill(null));
    H.v('2d. pas une chaîne : null', [null, undefined, 5, true, ['staff'], { staff: 1 }].map(t), Array(6).fill(null));
    H.v('2e. plus de 4 marques : null', [t('staff+prerelease+league+championship+toys-r-us'), t('staff+prerelease+league+championship')], [null, 'staff+prerelease+league+championship']);
    H.v('2f. des valeurs de Object.prototype ne sont pas des marques', ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].map(t), [null, null, null, null]);

    H.v('3a. normaliserVariante : la forme ancienne staff-prerelease se lit staff+prerelease, la canonique reste, tout le reste est null',
        ['staff-prerelease', 'staff+prerelease', 'staff', 'normale', 'jumbo', 'prerelease-staff', 'staff-league', 'Staff-Prerelease', 'hasOwnProperty'].map(M.normaliserVariante),
        ['staff+prerelease', 'staff+prerelease', 'staff', 'normale', 'jumbo', null, null, null, null]);
    H.v('3b. estVariante / estSpeciale : la normale n\'est pas spéciale, jumbo et les ensembles le sont, le hors-liste ne l\'est pas',
        [['normale', 'jumbo', 'staff', 'staff+prerelease', 'inconnu', null].map(M.estVariante), ['normale', 'jumbo', 'staff', 'staff+prerelease', 'inconnu', null].map(M.estSpeciale)],
        [[true, true, true, true, false, false], [false, true, true, true, false, false]]);

    H.v('4a. ensembleDe : dédoublonné et remis dans l\'ordre ; vide, hors liste, pas un tableau : null', [M.ensembleDe(['prerelease', 'staff', 'staff']), M.ensembleDe([]), M.ensembleDe(['staff', 'x']), M.ensembleDe('staff'), M.ensembleDe(null)], [['staff', 'prerelease'], null, null, null, null]);
    H.v('4b. jetonDeMarques : le jeton canonique', [M.jetonDeMarques(['prerelease', 'staff']), M.jetonDeMarques(['place-2', 'league']), M.jetonDeMarques(['staff']), M.jetonDeMarques([])], ['staff+prerelease', 'league+place-2', 'staff', null]);
    H.v('4c. marquesProuvees : le champ additif du contrat — les marques ; [] pour la normale ; null pour jumbo, hors forme, absente (« on ne sait pas » n\'est jamais « aucune marque »)', [M.marquesProuvees('staff+prerelease'), M.marquesProuvees('staff'), M.marquesProuvees('normale'), M.marquesProuvees('jumbo'), M.marquesProuvees('x'), M.marquesProuvees(null), M.marquesProuvees('prerelease+staff')], [['staff', 'prerelease'], ['staff'], [], null, null, null, null]);
    const r = M.lireVariante('staff+prerelease');
    H.v('4d. le résultat de lireVariante est gelé (le tableau de marques ne se modifie pas)', [Object.isFrozen(r), Object.isFrozen(r.marques)], [true, true]);
    H.bilan();
})().catch(x => { console.error(x); process.exitCode = 1; });
