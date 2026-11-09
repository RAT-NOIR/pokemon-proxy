// Banc de ajouter-set-par-ligne.js : doubles en mémoire seulement, aucune connexion, aucun chemin du poste.
const A = require('./ajouter-set-par-ligne');
let ok = 0, ko = 0;
const file = [];
const t = (nom, f) => file.push([nom, f]);
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const SET = 'Challenge-from-the-Darkness';
const carte = (o = {}) => ({ _id: 25392, nomEn: 'Blaine\'s Quiz #3', sets: ['Autre'], liens: { idProduct: [1] }, ...o });
const ligne = (o = {}) => ({ _id: '25392|605406', carteId: 25392, idProduct: 605406, slugSet: SET, preuve: 'fiche-prouvee', ...o });
const monde = (o = {}) => ({ carteDoc: carte(), lignes: [ligne()], interdits: new Set(), ...o });
const JUGE_OUI = () => ({ autorise: true, regle: 'R1', cause: 'C2a', raison: 'ok' });
const JUGE_NON = () => ({ autorise: false, regle: null, cause: 'C4a', raison: 'la Setlist ne nomme ni ce n° ni cette carte' });
const plan = (args = {}, m = monde(), juger = JUGE_OUI) => A.planifier({ carte: 25392, set: SET, produits: [605406], attendu: 1, ...args }, m, juger);
const refus = (r, motif) => { if (r.ok) throw new Error('devait refuser'); if (!r.refus.some(x => x.includes(motif))) throw new Error(`motif absent « ${motif} » dans ${JSON.stringify(r.refus)}`); if (r.operations.length) throw new Error('des opérations malgré le refus'); };

t('nominal : une opération $addToSet seule, par _id', () => {
    const r = plan();
    eq(r.ok, true); eq(r.ecritures, 1);
    eq(r.operations, [{ updateOne: { filter: { _id: 25392 }, update: { $addToSet: { sets: { $each: [SET] } } } } }]);
});
t('nominal : liste fermée de deux produits de la même carte', () => {
    const m = monde({ lignes: [ligne(), ligne({ _id: '25392|605407', idProduct: 605407 })] });
    eq(plan({ produits: [605406, 605407] }, m).ok, true);
});
t('refus : juge absent (jamais de repli)', () => { let m = ''; try { A.planifier({ carte: 1, set: 's', produits: [1], attendu: 1 }, monde(), undefined); } catch (e) { m = e.message; } if (!/règle R/.test(m)) throw new Error('non refusé'); });
t('refus : la règle R refuse', () => refus(plan({}, monde(), JUGE_NON), 'règle R'));
t('refus : la cause de R est nommée', () => refus(plan({}, monde(), JUGE_NON), 'C4a'));
t('refus : carte absente', () => refus(plan({}, monde({ carteDoc: null })), 'carte'));
t('refus : carte déjà membre du set (rien à faire)', () => refus(plan({}, monde({ carteDoc: carte({ sets: [SET] }) })), 'déjà'));
t('refus : aucune ligne pour le produit', () => refus(plan({}, monde({ lignes: [] })), 'aucune ligne'));
t('refus : ligne d\'une autre carte seulement', () => refus(plan({}, monde({ lignes: [ligne({ _id: '9|605406', carteId: 9 })] })), 'aucune ligne'));
t('refus : ligne d\'un autre set', () => refus(plan({}, monde({ lignes: [ligne({ slugSet: 'Autre-Set' })] })), 'slugSet'));
t('refus : ligne sans slugSet', () => refus(plan({}, monde({ lignes: [ligne({ slugSet: null })] })), 'slugSet'));
t('refus : ligne détachée (restes)', () => refus(plan({}, monde({ interdits: new Set(['25392|605406']) })), 'détachée'));
t('refus : un produit de la liste sans ligne refuse tout', () => refus(plan({ produits: [605406, 999] }), '999'));
t('refus : doublon dans la liste', () => refus(plan({ produits: [605406, 605406] }), 'doublon'));
t('refus : liste vide', () => refus(plan({ produits: [] }), 'produit'));
t('refus : attendu différent', () => refus(plan({ attendu: 2 }), 'attendu'));
t('refus : attendu absent', () => refus(plan({ attendu: undefined }), 'attendu'));
t('les opérations passent la garde du site (liste fermée)', () => { require('./collecte-cartes/regle-r-fiches').garderEcritureSite(plan().operations); });

t('arguments : cas nominal', () => { const r = A.lireArguments(['--carte=25392', '--set=' + SET, '--code=G2', '--produit=605406', '--attendu=1']); eq([r.erreur, r.carte, r.set, r.code, r.produits, r.attendu, r.ecrire], [undefined, 25392, SET, 'G2', [605406], 1, false]); });
t('arguments : liste fermée', () => eq(A.lireArguments(['--carte=1', '--set=s', '--code=c', '--produits=2,3', '--attendu=1']).produits, [2, 3]));
t('arguments : --attendu obligatoire', () => { if (!A.lireArguments(['--carte=1', '--set=s', '--code=c', '--produit=2']).erreur) throw new Error('accepté'); });
t('arguments : --produit et --produits ensemble refusés', () => { if (!A.lireArguments(['--carte=1', '--set=s', '--code=c', '--produit=2', '--produits=3,4', '--attendu=1']).erreur) throw new Error('accepté'); });
t('arguments : ni produit ni produits', () => { if (!A.lireArguments(['--carte=1', '--set=s', '--code=c', '--attendu=1']).erreur) throw new Error('accepté'); });
t('arguments : carte non entière', () => { if (!A.lireArguments(['--carte=x', '--set=s', '--code=c', '--produit=2', '--attendu=1']).erreur) throw new Error('accepté'); });
t('arguments : inconnu refusé', () => { if (!A.lireArguments(['--carte=1', '--set=s', '--code=c', '--produit=2', '--attendu=1', '--force']).erreur) throw new Error('accepté'); });
t('arguments : carte répétée refusée', () => { if (!A.lireArguments(['--carte=1', '--carte=2', '--set=s', '--code=c', '--produit=2', '--attendu=1']).erreur) throw new Error('accepté'); });
t('arguments : liste de plus de 10 refusée', () => { if (!A.lireArguments(['--carte=1', '--set=s', '--code=c', '--produits=' + Array.from({ length: 11 }, (_, i) => i + 1).join(','), '--attendu=1']).erreur) throw new Error('accepté'); });

t('hors lot refusé', () => { let m = ''; try { A.garderSousLot({}, 123); } catch (e) { m = e.message; } if (!/hors de lot-additif/.test(m)) throw new Error('non refusé'); });
t('hors lot : mauvais ppid refusé', () => { let m = ''; try { A.garderSousLot({ LOT_ADDITIF_PID: '5' }, 6); } catch (e) { m = e.message; } if (!m) throw new Error('non refusé'); });
t('sous lot accepté', () => { A.garderSousLot({ LOT_ADDITIF_PID: '5' }, 5); });

t('relecture concordante / discordante', () => {
    eq(A.releve({ carteDoc: carte({ sets: ['Autre', SET] }) }, { set: SET }).ok, true);
    eq(A.releve({ carteDoc: carte() }, { set: SET }).ok, false);
    eq(A.releve({ carteDoc: null }, { set: SET }).ok, false);
});

function fauxDb({ modifie = 1, interdits = [] } = {}) {
    const etat = { carte: carte(), bulk: [] };
    const col = {
        cartes: { findOne: async f => (f._id === etat.carte._id ? etat.carte : null), bulkWrite: async ops => { etat.bulk.push(ops); if (!modifie) return { modifiedCount: 0 }; for (const o of ops) for (const s of o.updateOne.update.$addToSet.sets.$each) if (!etat.carte.sets.includes(s)) etat.carte.sets.push(s); return { modifiedCount: modifie }; } },
        cartes_produits: { find: f => ({ toArray: async () => [ligne()].filter(l => l.carteId === f.carteId && f.idProduct.$in.includes(l.idProduct)) }) },
        restes: { find: () => ({ toArray: async () => interdits }) },
    };
    return { collection: n => col[n], _etat: etat };
}
const ARGS = { carte: 25392, set: SET, code: 'G2', produits: [605406], attendu: 1, ecrire: true };
t('chaîne : écriture, relecture, succès', async () => {
    const db = fauxDb(); const r = await A.executer(db, ARGS, JUGE_OUI);
    eq([r.ok, r.code, r.modifiees], [true, 0, 1]); eq(db._etat.carte.sets, ['Autre', SET]);
});
t('chaîne : simulation n\'écrit rien', async () => {
    const db = fauxDb(); const r = await A.executer(db, { ...ARGS, ecrire: false }, JUGE_OUI);
    eq([r.ok, r.code, r.modifiees], [true, 0, 0]); eq(db._etat.bulk.length, 0);
});
t('chaîne : refus de R, rien d\'écrit', async () => {
    const db = fauxDb(); const r = await A.executer(db, ARGS, JUGE_NON);
    eq([r.ok, r.code], [false, 1]); eq(db._etat.bulk.length, 0);
});
t('chaîne : ligne détachée lue dans restes, rien d\'écrit', async () => {
    const db = fauxDb({ interdits: [{ type: 'fiche-contredite-par-la-vue', carteId: 25392, idProduct: 605406 }] }); const r = await A.executer(db, ARGS, JUGE_OUI);
    eq([r.ok, r.code], [false, 1]); eq(db._etat.bulk.length, 0);
});
t('chaîne : écriture qui ne modifie rien -> arrêt', async () => {
    const db = fauxDb({ modifie: 0 }); const r = await A.executer(db, ARGS, JUGE_OUI);
    eq([r.ok, r.code, r.modifiees], [false, 1, 0]);
});

(async () => {
    for (const [nom, f] of file) { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom} : ${e.message}`); } }
    console.log(`${ko ? 'ROUGE' : 'VERT'} : ${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
