// node test-reprise-tpc.js — la reprise d'unités pokemon-card.com déjà passées (remettre-en-file.js --reprendre-tpc), sous la garde du commit du worker.
// Faux objets (aucune base) : une unité hors liste est refusée ; garde rouge ou impossible à conclure → aucune écriture ; mesure seule → aucune écriture.
const { reprendreTpc } = require('./remettre-en-file');
const { ligneTpc } = require('./collecte-cartes/tpc-sets');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const fabrique = docs => { const ecrits = []; return { ecrits, findOne: async f => docs[f._id] ?? null, updateOne: async (f, u) => { ecrits.push({ f, u }); return { modifiedCount: docs[f._id]?.etat === f.etat ? 1 : 0 }; } }; };
const vert = { bloque: false, commit: 'abc1234', phrase: 'ok' }, rouge = { bloque: true, phrase: 'une règle n\'est pas portée' };
(async () => {
    const docs = () => ({ 'pokemon-card-com/Space-Time-Creation': { etat: 'fait', resultat: 'verifie' }, 'pokemon-card-com/Eevee-GX-Starter-Sets': { etat: 'attente' }, 'pokemon-card-com/XY-Beginning-Set': { etat: 'refuse', resultat: 'refuse-table' } });
    const R = (slugs, garde, ecrire, d = docs()) => { const f = fabrique(d); return reprendreTpc({ slugs, file: f, garde, ecrire, lignes: s => ligneTpc('pokemon-card-com', s) }).then(r => ({ r, f })); };
    let { r, f } = await R(['Space-Time-Creation'], vert, true);
    verifier('une unité fait, garde verte, --ecrire → remise en file avec le motif et le commit', [r.ecrites, f.ecrits.length, f.ecrits[0]?.u.$set.etat, /règles A\/B de tpc\.js, commit abc1234/.test(f.ecrits[0]?.u.$set.remisEnFileMotif), f.ecrits[0]?.f.etat], [1, 1, 'attente', true, 'fait']);
    ({ r, f } = await R(['Space-Time-Creation'], vert, false));
    verifier('mesure seule (défaut) : l\'unité est retenue, AUCUNE écriture', [r.retenues.length, f.ecrits.length, r.ecriture], [1, 0, false]);
    ({ r, f } = await R(['Space-Time-Creation'], rouge, true));
    verifier('garde rouge → AUCUNE écriture, et la raison est dite', [f.ecrits.length, r.bloque, /règle n'est pas portée/.test(r.raison)], [0, true, true]);
    ({ r, f } = await R(['Space-Time-Creation'], undefined, true));
    verifier('garde absente (impossible à conclure) → aucune écriture', [f.ecrits.length, r.bloque], [0, true]);
    ({ r, f } = await R(['Space-Time-Creation'], { bloque: false }, true));
    verifier('garde « verte » sans commit → aucune écriture (le motif ne pourrait pas dire le commit)', [f.ecrits.length, r.bloque], [0, true]);
    ({ r, f } = await R(['Sword-Shield-Promos-Imaginaire', 'Space-Time-Creation'], vert, true));
    verifier('un slug hors de tpc-sets.js est refusé « hors-table », l\'autre passe', [r.refusees.map(x => x.motif), r.ecrites], [['hors-table'], 1]);
    ({ r, f } = await R(['Eevee-GX-Starter-Sets', 'XY-Beginning-Set'], vert, true));
    verifier('une unité en attente ou refusée n\'est jamais reprise', [r.refusees.map(x => x.motif), f.ecrits.length], [['etat-non-fait', 'etat-non-fait'], 0]);
    ({ r, f } = await R(['Space-Time-Creation'], vert, true, {}));
    verifier('une unité absente n\'est pas créée par une reprise', [r.refusees.map(x => x.motif), f.ecrits.length], [['unite-absente'], 0]);
    for (const mauvais of [[], ['*'], ['tous'], ['a b'], ['../x'], undefined]) { ({ r, f } = await R(mauvais, vert, true)); verifier(`liste non fermée (${JSON.stringify(mauvais)}) → refus, aucune écriture`, [r.bloque || (r.retenues.length === 0 && r.refusees.length > 0), f.ecrits.length], [true, 0]); }
    ({ r, f } = await R(Array.from({ length: 31 }, (_, i) => `S${i}`), vert, true));
    verifier('plus de 30 unités → plus une liste fermée', [r.bloque, f.ecrits.length], [true, 0]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(2); });
