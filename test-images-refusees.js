// BANC — une ligne de table peut REFUSER toute image (`imagesRefusees: '<raison>'`) : aucune source ne la collecte, aucune file ne l'enfile (lot X30C, 2026-10-13).
//   node test-images-refusees.js
// Raison d'être : x30C (30th Celebration Additionals) = Mewtwo 063 « What's Your Favorite? » TAMPONNÉ (holo) et Eevee 116 holo de blister — le scan TCGdex du parent
// (non tamponné) serait l'image d'une AUTRE impression (CLAUDE.md : « les réimpressions tamponnées ne reçoivent jamais l'image d'une autre impression »).
// Pur : aucune base, aucun réseau.
const { imagesRefusees } = require('./collecte-cartes/images-refusees');
const { setDeLaLigne, fabriquerAppariement } = require('./collecte-cartes/tcgdex-cache');
const { choisirUnites } = require('./collecte-cartes/alimentateur');
const { relevedeCeCollecteur } = require('./collecteur-images-bulba');
const { releve } = require('./collecteur-images-tcgdex');
const { ligne } = require('./collecte-cartes/table-sets');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const sets = [{ id: '30th', name: '30th Celebration' }];
const L = { code: 'zz', slugSet: 'Zz', region: 'occidental', bulba: { tirage: 'intl', expansion: '30th Celebration' } };
const LR = { ...L, imagesRefusees: 'scan du parent = autre impression (tampon)' };

verifier('ligne sans le champ : images permises (null)', imagesRefusees(L), null);
verifier('ligne absente : null (les autres gardes la refusent)', imagesRefusees(null), null);
verifier('ligne qui déclare une raison : la raison', imagesRefusees(LR), 'scan du parent = autre impression (tampon)');
verifier('une garde écrite par ce qu\'elle autorise : le champ présent mais mal formé (true, vide) REFUSE aussi', [imagesRefusees({ ...L, imagesRefusees: true }) !== null, imagesRefusees({ ...L, imagesRefusees: '' }) !== null, imagesRefusees({ ...L, imagesRefusees: false }) !== null], [true, true, true]);

const apparier = fabriquerAppariement(sets);
verifier('TCGdex : la ligne ordinaire trouve son set', setDeLaLigne(L, apparier).set?.id, '30th');
verifier('TCGdex : la ligne qui refuse les images ne trouve AUCUN set, et dit pourquoi', (() => { const d = setDeLaLigne(LR, apparier); return [d.set ?? null, /images refusées/.test(d.motif)]; })(), [null, true]);

const R = choisirUnites({ manques: [{ slug: 'Zz', n: 2, sans: 2 }], ligneDe: () => LR, sourceArtofpkm: () => false, setTcgdex: () => ({ id: '30th', name: '30th Celebration' }), texteFini: () => null, unites: new Map(), max: 10, sourcesEnService: new Set(['artofpkm', 'tcgdex', 'bulbapedia']) });
verifier('alimentateur : rien n\'est enfilé, TOUTES sources en service, et la raison est nommée', [R.inserer, R.reprendre, R.ecartes.map(e => [e.slug, /images refusées/.test(e.raison)])], [[], [], [['Zz', true]]]);
const R2 = choisirUnites({ manques: [{ slug: 'Zz', n: 2, sans: 2 }], ligneDe: () => L, sourceArtofpkm: () => false, setTcgdex: () => ({ id: '30th', name: '30th Celebration' }), texteFini: () => null, unites: new Map(), max: 10, sourcesEnService: new Set(['tcgdex']) });
verifier('témoin : la MÊME ligne sans le champ est enfilée (le banc sait dire oui)', R2.inserer.map(u => u._id), ['tcgdex/zz']);

verifier('collecteur Bulbapedia : refus nommé', (() => { const r = relevedeCeCollecteur(LR); return [r.ok, r.etat, /images refusées/.test(r.motif)]; })(), [false, 'refuse-images', true]);
verifier('collecteur Bulbapedia, témoin : la ligne ordinaire passe', relevedeCeCollecteur(L).ok, true);
verifier('collecteur TCGdex (releve) : la ligne x30C RÉELLE refuse, même avec une unité qui nomme le set 30th', (() => {
    const r = releve({ code: 'x30C', tcgdexSet: '30th' }, sets);
    return [r.ok, r.etat, /images refusées/.test(r.motif || '')];
})(), [false, 'refuse-images', true]);
verifier('collecteur TCGdex (releve), témoin : la ligne 30C réelle (même page) passe', releve({ code: '30C', tcgdexSet: '30th' }, sets).ok, true);

// la ligne RÉELLE de la table
const X = ligne('x30C');
verifier('table réelle : x30C déclare le refus avec une raison qui nomme le tampon et les deux cartes', [typeof X?.imagesRefusees, /Mewtwo/.test(X?.imagesRefusees || ''), /Eevee/.test(X?.imagesRefusees || ''), /tamp/i.test(X?.imagesRefusees || '')], ['string', true, true, true]);
verifier('table réelle : la base 30C (même page) ne refuse rien', imagesRefusees(ligne('30C')), null);
console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
