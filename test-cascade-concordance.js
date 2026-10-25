'use strict';
// Banc de deciderVisuel (collecte-cartes/concordance-image.js). Logique de cascade : comparateur injecté (table de mesures) ; une branche avec de VRAIES images fabriquées (sharp).
const sharp = require('sharp');
const C = require('./collecte-cartes/concordance-image');

let ok = 0, ko = 0;
function v(nom, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? 'OK ' : 'KO '} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}

const STRICT = { phash: 2, inliers: 45 }, SOUPLE = { phash: 5, inliers: 33 }, RIEN = { phash: 30, inliers: 2 };
function comparerDe(table) { return async (x, y) => { const k = [x.id, y.id].sort().join('|'); return k in table ? table[k] : RIEN; }; }
const produit = { langue: 'fr', codeSet: 'PAL', numero: '012', tampon: null };
const T = (o = {}) => ({ langue: 'fr', codeSet: 'PAL', numero: '12', tampon: null, ...o });
const cand = (id, source, tirage = T()) => ({ id, source, tirage });
const scan = (id) => ({ id, source: `scan-${id}` });
const decider = (candidats, scansConformes, table) => C.deciderVisuel({ produit, candidats, scansConformes }, { comparer: comparerDe(table) });

(async () => {
    let r;
    r = await decider([cand('a', 's1'), cand('b', 's2')], [], { 'a|b': STRICT });
    v('1. paire stricte, deux sources : écrire', r.decision, 'ecrire');
    r = await decider([cand('a', 's1'), cand('b', 's1')], [], { 'a|b': STRICT });
    v('1b. paire stricte mais MÊME source : pas indépendante, une seule source', [r.decision, r.motif], ['trou', 'une-seule-source']);
    r = await decider([cand('a', 's1'), cand('b', 's2'), cand('c', 's3')], [], { 'a|b': SOUPLE, 'a|c': SOUPLE });
    v('2. souple + troisième source concordante : écrire', r.decision, 'ecrire');
    r = await decider([cand('a', 's1'), cand('b', 's2'), cand('c', 's2')], [], { 'a|b': SOUPLE, 'a|c': SOUPLE });
    v('2b. souple, la « troisième » est de la même source que la deuxième : à confirmer', r.decision, 'a-confirmer');
    r = await decider([cand('a', 's1'), cand('b', 's2')], [scan('z')], { 'a|b': SOUPLE, 'a|z': SOUPLE });
    v('3. souple + vrai scan conforme : écrire', r.decision, 'ecrire');
    r = await decider([cand('a', 's1'), cand('b', 's2')], [], { 'a|b': SOUPLE });
    v('4. souple seul : à confirmer', r.decision, 'a-confirmer');
    r = await decider([cand('a', 's1')], [scan('z')], { 'a|z': STRICT });
    v('5. une source + scan conforme au strict : écrire', r.decision, 'ecrire');
    r = await decider([cand('a', 's1')], [scan('z')], { 'a|z': SOUPLE });
    v('5b. une source + scan conforme en souple seulement : à confirmer', r.decision, 'a-confirmer');
    r = await decider([cand('a', 's1')], [scan('z'), scan('y')], { 'a|z': SOUPLE, 'a|y': SOUPLE });
    v('5c. une source + deux scans conformes en souple : écrire (troisième concordance)', r.decision, 'ecrire');
    r = await decider([cand('a', 's1'), cand('b', 's2')], [], {});
    v('6. rien ne concorde : trou / discordance-image', [r.decision, r.motif], ['trou', 'discordance-image']);
    r = await decider([], [], {});
    v('6b. aucun candidat : trou / aucune-source', [r.decision, r.motif], ['trou', 'aucune-source']);
    r = await decider([cand('a', 's1')], [], {});
    v('6c. un seul candidat : trou / une-seule-source', [r.decision, r.motif], ['trou', 'une-seule-source']);
    r = await C.deciderVisuel({ produit, candidats: [cand('a', 's1'), cand('b', 's2')], scansConformes: [] }, { comparer: async () => null });
    v('6d. images illisibles : trou / illisible', [r.decision, r.motif], ['trou', 'illisible']);

    // ── même tirage ──
    r = await decider([cand('a', 's1'), cand('b', 's2', T({ langue: 'en' }))], [], { 'a|b': STRICT });
    v('7. langue différente : exclu, même avec une paire stricte', [r.decision, r.motif, r.preuve.exclusTirage], ['trou', 'tirage-different', 1]);
    r = await decider([cand('a', 's1'), cand('b', 's2', T({ langue: null }))], [], { 'a|b': STRICT });
    v('8. langue ABSENTE côté candidat : exclu (je ne sais pas n\'est pas oui)', [r.decision, r.preuve.exclusTirage], ['trou', 1]);
    r = await decider([cand('a', 's1'), cand('b', 's2', T({ numero: '13' }))], [], { 'a|b': STRICT });
    v('9. numéro contredit : exclu', [r.decision, r.preuve.exclusTirage], ['trou', 1]);
    r = await decider([cand('a', 's1', T({ numero: '012' })), cand('b', 's2', T({ numero: '12' }))], [], { 'a|b': STRICT });
    v('9b. « 012 » et « 12 » concordent après cleNumero', r.decision, 'ecrire');
    r = await decider([cand('a', 's1', T({ numero: null, codeSet: null })), cand('b', 's2', T({ numero: null, codeSet: null }))], [], { 'a|b': STRICT });
    v('10. numéro et code absents côté candidat : ne contredit pas, compté', [r.decision, r.preuve.exclusTirage], ['ecrire', 0]);
    r = await decider([cand('a', 's1'), cand('b', 's2', T({ codeSet: 'OBF' }))], [], { 'a|b': STRICT });
    v('11. code de set contredit : exclu', r.preuve.exclusTirage, 1);
    r = await C.deciderVisuel({ produit: { ...produit, tampon: 'prerelease' }, candidats: [cand('a', 's1', T({ tampon: 'prerelease' })), cand('b', 's2', T({ tampon: null }))], scansConformes: [] }, { comparer: comparerDe({ 'a|b': STRICT }) });
    v('12. produit tamponné : un candidat sans le même tampon est exclu', [r.decision, r.preuve.exclusTirage], ['trou', 1]);

    // ── vraies images : une image IDENTIQUE d'un autre tirage ne passe pas ──
    const l = 300, h = 420, b = Buffer.alloc(l * h * 3, 128);
    let x = 7; const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
    for (let k = 0; k < 220; k++) { const x0 = Math.floor(rnd() * (l - 20)), y0 = Math.floor(rnd() * (h - 20)), w = 8 + Math.floor(rnd() * 60), hh = 8 + Math.floor(rnd() * 60), c = Math.floor(rnd() * 256); for (let y = y0; y < Math.min(h, y0 + hh); y++) for (let xx = x0; xx < Math.min(l, x0 + w); xx++) { const o = (y * l + xx) * 3; b[o] = b[o + 1] = b[o + 2] = c; } }
    const A = await sharp(b, { raw: { width: l, height: h, channels: 3 } }).png().toBuffer();
    const A2 = await sharp(A).webp({ lossless: true }).toBuffer();   // autre encodage, mêmes pixels (un JPEG q90 donne pHash 4 sur cet aplat : « souple », comme la calibration le prévoit)
    r = await C.deciderVisuel({ produit, candidats: [{ source: 's1', buf: A, tirage: T() }, { source: 's2', buf: A2, tirage: T() }], scansConformes: [] });
    v('13. vraies images, même tirage, deux sources : écrire', r.decision, 'ecrire');
    r = await C.deciderVisuel({ produit, candidats: [{ source: 's1', buf: A, tirage: T() }, { source: 's2', buf: A, tirage: T({ langue: 'ja' }) }], scansConformes: [] });
    v('14. vraies images IDENTIQUES, langue différente : exclu, pas d\'écriture', [r.decision, r.motif, r.preuve.exclusTirage], ['trou', 'tirage-different', 1]);

    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
