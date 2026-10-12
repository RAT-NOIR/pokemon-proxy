// node test-poser-basse-definition.js — le rattrapage `poser-basse-definition.js` : sa partie PURE (`planifier`), sur des documents fabriqués.
// Ce que le banc garde : la marque se pose d'après la largeur de l'ORIGINAL (seuils-images.js), jamais sur une largeur inconnue ni sur un
// fichier plafonné ; elle ne se pose que là où elle MANQUE (additif strict) ; chaque décompte porte son dénominateur ; et l'outil n'écrit rien sans --ecrire.
const fs = require('fs');
const path = require('path');
const { planifier } = require('./poser-basse-definition');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const docs = [
    { _id: 'd1', source: 'tpc-asie', set: 'A', cleR2: 'k1', etat: 'ok', wOriginal: 300, w: 300 },                  // basse définition, entrée à marquer
    { _id: 'd2', source: 'tpc-asie', set: 'A', cleR2: 'k2', etat: 'ok', wOriginal: 349, w: 349 },                  // 349 : basse
    { _id: 'd3', source: 'tpc-asie', set: 'A', cleR2: 'k3', etat: 'ok', wOriginal: 350, w: 350 },                  // 350 : pas basse
    { _id: 'd4', source: 'pikaqian', set: 'B', cleR2: 'k4', etat: 'ok', wOriginal: 300, w: 300, basseDefinition: true },   // déjà marquée (document)
    { _id: 'd5', source: 'pikaqian', set: 'B', cleR2: 'k5', etat: 'ok', w: 300 },                                  // sans wOriginal, w sous le plafond servi → basse
    { _id: 'd6', source: 'bulbapedia', set: 'C', cleR2: 'k6', etat: 'ok', w: 700 },                                // plafonné : l'original est inconnu → ni marquée ni comptée basse
    { _id: 'd7', source: 'bulbapedia', set: 'C', cleR2: 'k7', etat: 'ok' },                                        // aucune largeur
    { _id: 'd8', source: 'tpc-asie', set: 'A', cleR2: 'k8', etat: 'trop-petit', wOriginal: 280 },                  // jamais joint : hors du périmètre (etat ok seulement)
    { _id: 'd9', source: 'tcgdex', set: 'D', cleR2: 'k9', etat: 'ok', wOriginal: 1000, w: 700 }
];
const cartes = [
    { _id: 1, images: [{ set: 'A', source: 'tpc-asie', cleR2: 'k1', w: 300 }, { set: 'A', source: 'tpc-asie', cleR2: 'k3', w: 350 }] },
    { _id: 2, images: [{ set: 'A', source: 'tpc-asie', cleR2: 'k2', w: 349 }, { set: 'B', source: 'pikaqian', cleR2: 'k4', w: 300, basseDefinition: true }] },
    { _id: 3, images: [{ set: 'B', source: 'pikaqian', cleR2: 'k5', w: 300 }, { set: 'C', source: 'bulbapedia', cleR2: 'k6', w: 700 }, { set: 'D', source: 'tcgdex', cleR2: 'k9', w: 700 }] },
    { _id: 4, images: [{ set: 'Z', source: 'tpc-asie', cleR2: 'orpheline', w: 320 }] },                                                   // sans document : l'entrée porte `w` < 700
    { _id: 5, images: [] }
];
const P = planifier(docs, cartes);
verifier('documents à marquer : seulement ceux de basse définition qui ne l\'ont pas encore (d1, d2, d5)', P.docsAEcrire.map(d => d._id), ['d1', 'd2', 'd5']);
verifier('entrées à marquer : par (carte, cleR2), seulement là où la marque manque (k1, k2, k5, et l\'orpheline par son `w`)', P.entreesAEcrire.map(e => `${e.carteId}|${e.cleR2}`), ['1|k1', '2|k2', '3|k5', '4|orpheline']);
verifier('une entrée déjà marquée n\'est pas réécrite (k4)', P.entreesAEcrire.some(e => e.cleR2 === 'k4'), false);
verifier('une largeur plafonnée (700) ou inconnue n\'est jamais marquée (k6, k7, k9)', P.entreesAEcrire.concat(P.docsAEcrire.map(d => ({ cleR2: d.cleR2 }))).some(e => ['k6', 'k7', 'k9'].includes(e.cleR2)), false);
verifier('un document `trop-petit` est hors du périmètre (jamais joint)', P.docsAEcrire.some(d => d._id === 'd8'), false);
verifier('le dénominateur : documents ok, dont largeur connue, dont basse définition, dont déjà marqués',
    [P.compte.documentsOk, P.compte.largeurConnue, P.compte.basseDefinition, P.compte.dejaMarques], [8, 6, 4, 1]);
verifier('par source (documents ok de basse définition) : tpc-asie 2, pikaqian 2', P.compte.parSource, { 'tpc-asie': 2, pikaqian: 2 });
verifier('par set : A 2, B 2', P.compte.parSet, { A: 2, B: 2 });
verifier('entrées : total, de basse définition, déjà marquées, à écrire', [P.compte.entrees, P.compte.entreesBasses, P.compte.entreesDejaMarquees, P.entreesAEcrire.length], [8, 5, 1, 4]);
verifier('largeur inconnue (documents ok sans largeur d\'origine exploitable) : comptée à part', P.compte.largeurInconnue, 2);
const rejouee = planifier(docs.map(d => ({ ...d, ...(P.docsAEcrire.some(x => x._id === d._id) ? { basseDefinition: true } : {}) })), cartes.map(c => ({ ...c, images: c.images.map(e => P.entreesAEcrire.some(x => x.carteId === c._id && x.cleR2 === e.cleR2) ? { ...e, basseDefinition: true } : e) })));
verifier('IDEMPOTENT : une fois marquées, rien à écrire', [rejouee.docsAEcrire.length, rejouee.entreesAEcrire.length], [0, 0]);

// ── l'outil n'écrit rien sans --ecrire, et l'écriture est conditionnée à l'ABSENCE du champ ─────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, 'poser-basse-definition.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
verifier('toute écriture est derrière --ecrire (un seul bloc d\'écriture, après la sortie en mesure)', /if \(!ecrire\)/.test(src) && src.indexOf('if (!ecrire)') < src.indexOf('.bulkWrite(') && (src.match(/\.bulkWrite\(/g) || []).length === 2 && !/\.(updateOne|updateMany|insertOne|insertMany|deleteOne|deleteMany|replaceOne)\(/.test(src), true);
verifier('l\'écriture ne pose QUE `basseDefinition`, et seulement si le champ est absent ($exists: false)', [/\$set: \{ basseDefinition: true \}/.test(src), /basseDefinition: \{ \$exists: false \}/.test(src), /'images\.\$\[e\]\.basseDefinition'/.test(src)], [true, true, true]);
verifier('la largeur vient de seuils-images (estBasseDefinition, largeurOriginaleDe), jamais d\'un nombre recopié', [/estBasseDefinition/.test(src), /largeurOriginaleDe/.test(src), /<\s*350\b/.test(src)], [true, true, false]);

console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
process.exit(ko ? 1 : 0);
