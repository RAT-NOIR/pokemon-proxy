// Banc de poser-nomja-fiches.js (aucune base, aucun réseau) : la PLANIFICATION est pure, on la fait dire NON sur des états fabriqués.
// Décision du testeur du 2026-11-02 : « nomJa (null -> nom) : feu vert pour les noms avec preuve, anciennes valeurs journalisées ».
const { spawnSync } = require('child_process');
const path = require('path');
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };

const P = require('./collecte-cartes/plan-nomja-fiches');

const e = (carteId, nomEn, nomJaPage, extra = {}) => ({ lot: 'T', idProduct: Math.abs(carteId), carteId, nomEn, pcg: 'x', nomJaPage, autresCartesMemeNom: [], concordeAvecAutreCarte: false, ...extra });
const cartes = [
    { _id: -1, nomEn: 'Latios ex', nomJa: null },                       // null : posable
    { _id: -2, nomEn: 'Charmander' },                                    // champ absent : posable
    { _id: -3, nomEn: 'Abra', nomJa: 'ケーシィ' },                        // valeur existante DIFFÉRENTE : refus
    { _id: -4, nomEn: 'Pikachu', nomJa: 'ピカチュウ' },                   // valeur existante IDENTIQUE : refus aussi
    { _id: -5, nomEn: 'Mew', nomJa: '' },                                // chaîne vide : ce n'est ni absent ni null -> refus
    { _id: -6, nomEn: 'Eevee' }, { _id: -7, nomEn: 'Snorlax' }
];

{
    const r = P.planifier({ entrees: [e(-1, 'Latios ex', 'ラティオスex', { concordeAvecAutreCarte: true }), e(-2, 'Charmander', 'ヒトカゲ')], cartes });
    egal('P1 null -> écrit', r.ecrire.map(x => [x.carteId, x.nomJa, x.ancien]), [[-1, 'ラティオスex', null], [-2, 'ヒトカゲ', null]]);
    egal('P1b l\'ancienne valeur null/absente est distinguée', r.ecrire.map(x => x.ancienEtat), ['null', 'absent']);
    egal('P1c décompte des deux catégories', r.concorde, { avecAutreCarte: 1, sansAutreCarte: 1 });
    egal('P1d aucun refus', r.refus.length, 0);
}
{
    const r = P.planifier({ entrees: [e(-3, 'Abra', 'ヤドン')], cartes });
    egal('P2 valeur existante différente : refus nommé', [r.ecrire.length, r.refus[0]?.motif], [0, 'nomJa-deja-pose']);
    const r2 = P.planifier({ entrees: [e(-4, 'Pikachu', 'ピカチュウ')], cartes });
    egal('P2b valeur existante IDENTIQUE : refus aussi (jamais d\'écrasement)', [r2.ecrire.length, r2.refus[0]?.motif], [0, 'nomJa-deja-pose']);
    const r3 = P.planifier({ entrees: [e(-5, 'Mew', 'ミュウ')], cartes });
    egal('P2c chaîne vide existante : refus (seuls absent et null sont posables)', [r3.ecrire.length, r3.refus[0]?.motif], [0, 'nomJa-deja-pose']);
}
{
    const m = en => P.planifier({ entrees: [en], cartes }).refus[0]?.motif;
    egal('P3 nomJaPage vide', m(e(-6, 'Eevee', '')), 'nomJaPage-vide');
    egal('P3b nomJaPage espaces', m(e(-6, 'Eevee', '   ')), 'nomJaPage-vide');
    egal('P3c nomJaPage absent', m(e(-6, 'Eevee', undefined)), 'nomJaPage-vide');
    egal('P3d nomJaPage latin', m(e(-6, 'Eevee', 'Eevee')), 'nomJaPage-non-japonais');
    egal('P3e nomJaPage non chaîne', m(e(-6, 'Eevee', 42)), 'nomJaPage-vide');
    egal('P3f katakana + latin accepté', P.planifier({ entrees: [e(-6, 'Eevee', 'イーブイex')], cartes }).ecrire.length, 1);
}
{
    const r = P.planifier({ entrees: [e(-999, 'Fantome', 'ゴース')], cartes });
    egal('P4 carte absente de la base : refus', [r.ecrire.length, r.refus[0]?.motif], [0, 'carte-absente']);
}
{
    const r = P.planifier({ entrees: [e(-6, 'Snorlax', 'カビゴン')], cartes });
    egal('P5 nomEn de la proposition ≠ nomEn de la carte : refus', [r.ecrire.length, r.refus[0]?.motif], [0, 'nomEn-different']);
}
{
    const r = P.planifier({ entrees: [e(-6, 'Eevee', 'イーブイ'), e(-6, 'Eevee', 'ブイ')], cartes });
    egal('P6 deux entrées pour une carte : les deux refusées', [r.ecrire.length, r.refus.map(x => x.motif)], [0, ['doublon-carte', 'doublon-carte']]);
}
{
    // invariant : tout élément du plan vise une carte dont nomJa est absent ou null
    const r = P.planifier({ entrees: cartes.map(c => e(c._id, c.nomEn, 'テスト')), cartes });
    egal('P7 invariant : le plan ne vise que absent/null', r.ecrire.every(x => { const c = cartes.find(k => k._id === x.carteId); return c.nomJa === undefined || c.nomJa === null; }), true);
    egal('P7b ... et il y en a bien (-1, -2, -6, -7)', r.ecrire.map(x => x.carteId).sort(), [-7, -6, -2, -1]);
}
{
    const le = new Date('2026-11-02T00:00:00Z');
    const ops = P.construireOps({ ecrire: [{ carteId: -1, nomJa: 'ラティオスex' }], le });
    egal('O1 filtre exact : _id + nomJa absent ou null', ops[0].updateOne.filter, { _id: -1, $or: [{ nomJa: { $exists: false } }, { nomJa: null }] });
    egal('O2 $set : le seul champ nomJa', ops[0].updateOne.update, { $set: { nomJa: 'ラティオスex' } });
    egal('O3 une updateOne par carte, sans upsert', [ops.length, Object.keys(ops[0]).join(), ops[0].updateOne.upsert], [1, 'updateOne', undefined]);
}

// ============ la ligne de commande ============
const js = path.join(__dirname, 'poser-nomja-fiches.js');
{
    const r = spawnSync(process.execPath, [js, '--decision=2026-11-02', '--ecrire', '--attendu=1'], { encoding: 'utf8', env: { ...process.env, LOT_ADDITIF_PID: '' } });
    egal('E1 --ecrire hors lot-additif : refus (code 2)', r.status, 2);
    const r2 = spawnSync(process.execPath, [js, '--decision=2026-11-02', '--inconnu'], { encoding: 'utf8' });
    egal('E2 argument inconnu : refus avant toute connexion (code 2)', r2.status, 2);
    const r3 = spawnSync(process.execPath, [js, '--decision=1999-01-01'], { encoding: 'utf8' });
    egal('E3 décision inconnue : refus (code 2)', r3.status, 2);
    const r4 = spawnSync(process.execPath, [js, '--decision=2026-11-02', '--ecrire'], { encoding: 'utf8', env: { ...process.env, LOT_ADDITIF_PID: String(process.pid) } });
    egal('E4 --ecrire sans --attendu : refus (code 2)', r4.status, 2);
    const r5 = spawnSync(process.execPath, [js], { encoding: 'utf8' });
    egal('E5 sans --decision : refus (code 2)', r5.status, 2);
    // LOT_ADDITIF_PID présent mais qui n'est PAS le parent du processus : refus (garderSousLot compare au ppid)
    const r6 = spawnSync(process.execPath, [js, '--decision=2026-11-02', '--ecrire', '--attendu=1'], { encoding: 'utf8', env: { ...process.env, LOT_ADDITIF_PID: '1' } });
    egal('E6 PID de lot qui n\'est pas le parent : refus (code 2)', r6.status, 2);
}

console.log(`${ko ? '❌' : '✅'} test-poser-nomja-fiches : ${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
