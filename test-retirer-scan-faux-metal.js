// node test-retirer-scan-faux-metal.js — le retrait à blanc des lignes de jointure des produits en matière spéciale (lot METAL). Collections et fichiers FABRIQUÉS : aucune base, aucun disque.
'use strict';
const R = require('./retirer-scan-faux-metal');
const { garderMatiereSpeciale } = require('./collecte-cartes/matiere-speciale');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// Une table de BANC (jamais la vraie) : 900 est en métal, 901 aussi (sans ligne), 910 est son frère normal.
const TABLE = { 900: { nom: 'Faux métal', frereNormal: 910, idExpansion: 70 }, 901: { nom: 'Faux métal 2', frereNormal: 911, idExpansion: 70 } };

// 1. le plan est PUR : seules les lignes des produits de la table se détachent
const lignes = [
    { _id: '1|900', carteId: 1, idProduct: 900, idExpansion: 70, slugSet: 'Banc', preuve: 'set+numero' },
    { _id: '1|910', carteId: 1, idProduct: 910, idExpansion: 70, slugSet: 'Banc', preuve: 'set+numero' },
    { _id: '2|900', carteId: 2, idProduct: 900, idExpansion: 70, slugSet: 'Autre', preuve: 'set+nom' },
    { _id: '3|920', carteId: 3, idProduct: 920, idExpansion: 70, slugSet: 'Banc', preuve: 'set+numero' },
];
const plan = R.planRetrait(TABLE, lignes);
verifier('le plan détache les 2 lignes du produit 900 et rien d\'autre', plan.aDetacher.map(l => l._id).sort(), ['1|900', '2|900']);
verifier('le plan nomme les produits de la table sans ligne', plan.sansLigne, [901]);
verifier('le plan nomme les cartes dont liens.idProduct perd le produit', plan.liens.map(x => `${x.carteId}|${x.idProduct}`).sort(), ['1|900', '2|900']);
verifier('le plan garde l\'ancienne ligne ENTIÈRE (pour la sauvegarde)', plan.aDetacher.find(l => l._id === '1|900').preuve, 'set+numero');
verifier('table vide : rien', R.planRetrait({}, lignes).aDetacher.length, 0);

// 2. l'annonce de lot est calculée par la fonction de la garde (compterEtat + comparer), jamais à la main
verifier('annonce : 1 fiche de moins sur l\'expansion 70 (le produit 900 perd ses 2 lignes, un seul produit distinct)', R.annonceDuRetrait(lignes, plan), { 'fiches exp:70': 1 });
verifier('annonce : rien à détacher, rien à annoncer', R.annonceDuRetrait(lignes, R.planRetrait({ 901: TABLE[901] }, lignes)), {});

// 3. --attendu : refus si le compte diffère, AVANT toute écriture
let msg = null; try { R.verifierAttendu(3, 2); } catch (e) { msg = e.message; }
verifier('attendu 3 contre 2 : refusé', /3/.test(msg || '') && /2/.test(msg || ''), true);
verifier('attendu égal : accepté', (() => { try { R.verifierAttendu(2, 2); return true; } catch (e) { return false; } })(), true);
let msg2 = null; try { R.verifierAttendu(undefined, 2, true); } catch (e) { msg2 = e.message; }
verifier('--ecrire sans --attendu : refusé', /--attendu/.test(msg2 || ''), true);

// 4. l'exécution sur collections fabriquées
function monde() {
    const etat = { lignes: structuredClone(lignes), cartes: new Map([[1, { _id: 1, liens: { idProduct: [900, 910] } }], [2, { _id: 2, liens: { idProduct: [900] } }]]), restes: [], fichiers: new Map(), appels: [] };
    const L = {
        find: (q) => ({ toArray: async () => etat.lignes.filter(l => (q.idProduct ? q.idProduct.$in.includes(l.idProduct) : true) && (q.idExpansion ? q.idExpansion.$in.includes(l.idExpansion) : true)).map(l => structuredClone(l)) }),
        deleteMany: async (q) => { etat.appels.push('delete'); const av = etat.lignes.length; etat.lignes = etat.lignes.filter(l => !q._id.$in.includes(l._id)); return { deletedCount: av - etat.lignes.length }; },
        countDocuments: async (q) => etat.lignes.filter(l => q._id.$in.includes(l._id)).length,
    };
    const C = { updateOne: async (f, u) => { etat.appels.push('carte'); const c = etat.cartes.get(f._id); c.liens.idProduct = c.liens.idProduct.filter(i => i !== u.$pull['liens.idProduct']); return { modifiedCount: 1 }; } };
    const Re = { updateOne: async (f, u) => { etat.appels.push('reste'); etat.restes.push({ f, u }); } };
    return { etat, L, C, Re, ecrireFichier: (nom, contenu) => { etat.appels.push('fichier:' + nom); etat.fichiers.set(nom, contenu); } };
}
(async () => {
    // à blanc (défaut) : AUCUNE écriture en base, deux fichiers (plan + annonce)
    let m = monde();
    let r = await R.executer({ L: m.L, C: m.C, R: m.Re, table: TABLE, ecrire: false, ecrireFichier: m.ecrireFichier, log: () => { } });
    verifier('à blanc : rien n\'est supprimé', [m.etat.lignes.length, m.etat.appels.filter(a => !a.startsWith('fichier:'))], [4, []]);
    verifier('à blanc : le plan et l\'annonce sont écrits en fichiers', [...m.etat.fichiers.keys()].sort(), ['annonce', 'plan']);
    verifier('à blanc : le compte à passer en --attendu est rendu', r.aDetacher, 2);
    verifier('à blanc : l\'annonce de fichier est celle de la garde', JSON.parse(m.etat.fichiers.get('annonce')), { 'fiches exp:70': 1 });

    // --ecrire avec un mauvais --attendu : refusé AVANT toute écriture (aucune sauvegarde non plus : rien n'a changé)
    m = monde(); let refus = null;
    try { await R.executer({ L: m.L, C: m.C, R: m.Re, table: TABLE, ecrire: true, attendu: 5, ecrireFichier: m.ecrireFichier, log: () => { } }); } catch (e) { refus = e.message; }
    verifier('--attendu=5 contre 2 : refusé', /5/.test(refus || ''), true);
    verifier('… et rien n\'est écrit (ni ligne, ni carte, ni fichier)', [m.etat.lignes.length, m.etat.appels], [4, []]);

    // --ecrire --attendu=2 : la sauvegarde est écrite AVANT la suppression
    m = monde();
    r = await R.executer({ L: m.L, C: m.C, R: m.Re, table: TABLE, ecrire: true, attendu: 2, ecrireFichier: m.ecrireFichier, log: () => { } });
    verifier('--ecrire : les 2 lignes sont détachées', [m.etat.lignes.map(l => l._id).sort(), r.detachees], [['1|910', '3|920'], 2]);
    verifier('--ecrire : la sauvegarde précède la suppression', m.etat.appels.findIndex(a => a === 'fichier:sauvegarde') < m.etat.appels.indexOf('delete') && m.etat.appels.indexOf('delete') >= 0, true);
    verifier('--ecrire : la sauvegarde contient les 2 anciennes lignes entières', JSON.parse(m.etat.fichiers.get('sauvegarde')).lignes.map(l => l._id).sort(), ['1|900', '2|900']);
    verifier('--ecrire : liens.idProduct des cartes ne porte plus le produit', [m.etat.cartes.get(1).liens.idProduct, m.etat.cartes.get(2).liens.idProduct], [[910], []]);
    verifier('--ecrire : un reste « produit-sans-carte » est écrit pour le produit resté sans ligne', m.etat.restes.map(x => [x.f.type, x.f.idProduct]), [['produit-sans-carte', 900]]);
    // idempotent : rejoué, plus rien à détacher, --attendu=0 passe
    r = await R.executer({ L: m.L, C: m.C, R: m.Re, table: TABLE, ecrire: true, attendu: 0, ecrireFichier: m.ecrireFichier, log: () => { } });
    verifier('rejeu : 0 ligne à détacher, rien ne change', [r.aDetacher, m.etat.lignes.length], [0, 2]);

    // 5. une table qui contient un produit absent de la TABLE RÉELLE n'est pas la table : la CLI lit la table du module, pas un argument
    verifier('la CLI lit la table fermée du module (580162 y est)', Object.keys(R.TABLE_REELLE).includes('580162'), true);
    verifier('la garde d\'écriture des poseurs refuse 580162 (même table)', (() => { try { garderMatiereSpeciale([580162], 'banc'); return false; } catch (e) { return true; } })(), true);

    // 6. M1 : `--ecrire` refuse de tourner hors de lot-additif.js (qui pose LOT_ADDITIF_PID = son pid ; le retrait en est l'enfant direct)
    const refuse = (env, ppid, ecrire) => { try { R.verifierSousLot(env, ppid, ecrire); return false; } catch (e) { return /lot-additif/.test(e.message); } };
    verifier('--ecrire lancé à la main (aucune variable) : refusé', refuse({}, 4242, true), true);
    verifier('--ecrire avec un pid de lot qui n\'est pas celui du parent : refusé', refuse({ LOT_ADDITIF_PID: '1' }, 4242, true), true);
    verifier('--ecrire sous lot-additif (pid = parent) : accepté', refuse({ LOT_ADDITIF_PID: '4242' }, 4242, true), false);
    verifier('à blanc : jamais refusé', refuse({}, 4242, false), false);
    verifier('lot-additif.js pose LOT_ADDITIF_PID pour la commande', /LOT_ADDITIF_PID:\s*String\(process\.pid\)/.test(require('fs').readFileSync(require('path').join(__dirname, 'lot-additif.js'), 'utf8')), true);

    console.log(`\ntest-retirer-scan-faux-metal : ${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
