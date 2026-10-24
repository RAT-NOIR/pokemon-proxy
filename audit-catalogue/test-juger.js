// node audit-catalogue/test-juger.js — le jugement d'UNE paire (lancer-comparaison.js::juger) : comparable seulement si tout est là, et le MOTIF de chaque incomparabilité.
const E = require('./empreinte');
const { juger } = require('./lancer-comparaison');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
// une empreinte synthétique à contraste : un motif de sinusoïdes (la phase change le motif)
// (une PHASE différente serait rattrapée par le recalage : c'est la FRÉQUENCE qui fait un autre motif)
const motif = (fc, fr) => { const b = Buffer.alloc(E.TAILLE); for (let r = 0; r < E.HAUTEUR; r++) for (let c = 0; c < E.LARGEUR; c++) for (let k = 0; k < 3; k++) b[(r * E.LARGEUR + c) * 3 + k] = Math.round(128 + 90 * Math.sin(c * fc + k) * Math.cos(r * fr)); return b; };
const plat = Buffer.alloc(E.TAILLE, 128);
const carte = { w: 255, h: 361 }, carre = { w: 300, h: 300 };
const base = { classe: 'A_COMPARER', copieLocale: true, fpNous: motif(0.45, 0.37), dimNous: { w: 200, h: 281 }, fpCm: motif(0.45, 0.37), dimCm: carte };

const ok1 = juger(base);
verifier('la même empreinte des deux côtés : comparable, distance ~0', [ok1.comparable, ok1.motif, ok1.distance < 1e-6, ok1.couleur < 1e-9], [true, null, true, true]);
const autre = juger({ ...base, fpCm: motif(0.19, 0.83) });
verifier('deux motifs différents : comparable, distance nettement positive', [autre.comparable, autre.distance > 0.3], [true, true]);
verifier('pas de copie locale', juger({ ...base, copieLocale: false, fpCm: null, dimCm: null }).motif, 'pas-de-copie-locale');
verifier('copie Cardmarket aplatie : non disponible', juger({ ...base, fpCm: plat }).motif, 'copie-cardmarket-non-disponible');
verifier('copie Cardmarket carrée (pas une carte) : format inattendu, distinct de l\'aplat', juger({ ...base, dimCm: carre }).motif, 'copie-cardmarket-format-inattendu');
verifier('notre vignette illisible (pas d\'empreinte)', juger({ ...base, fpNous: null, dimNous: null }).motif, 'visuel-nous-illisible');
verifier('notre vignette aplatie : illisible', juger({ ...base, fpNous: plat }).motif, 'visuel-nous-illisible');
verifier('notre vignette carrée : format inattendu', juger({ ...base, dimNous: carre }).motif, 'visuel-nous-format-inattendu');
const nc = juger({ ...base, copieLocale: false, fpCm: null, dimCm: null });
verifier('une paire incomparable ne porte AUCUNE distance (ni 0, ni NaN : null)', [nc.distance, nc.ncc, nc.couleur], [null, null, null]);

// L3 : on CLASSE avant d'arrondir — 0,5499996 s'arrondit à 0,55 (INCERTAIN) alors qu'il est sous le seuil (CONFORME)
const { enregistrer } = require('./lancer-comparaison');
const rb = d => ({ comparable: true, motif: null, distance: d, ncc: 1 - d, dx: 0, dy: 0, couleur: 0.123456789 });
const eb = enregistrer({ idProduct: 5, classe: 'A_COMPARER', motifsClasse: [], nom: 'Pikachu', r: rb(0.5499996) });
verifier('0,5499996 : classé CONFORME sur la valeur NON arrondie', eb.classeComparaison, 'CONFORME');
verifier('la distance écrite est la valeur brute (jamais arrondie avant classement : relue, elle classe pareil)', eb.distance, 0.5499996);
verifier('0,6499999 : INCERTAIN sur la valeur brute', enregistrer({ idProduct: 6, classe: 'A_COMPARER', motifsClasse: [], nom: 'Pikachu', r: rb(0.6499999) }).classeComparaison, 'INCERTAIN');
verifier('ncc et couleur restent arrondies (ce ne sont pas des seuils)', [eb.couleur], [0.12346]);
verifier('un produit incomparable : classe INVÉRIFIABLE avec son motif, distance null', (() => { const e = enregistrer({ idProduct: 7, classe: 'A_COMPARER', motifsClasse: [], nom: 'Pikachu', r: nc }); return [e.classeComparaison, e.distance]; })(), ['INVERIFIABLE', null]);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
