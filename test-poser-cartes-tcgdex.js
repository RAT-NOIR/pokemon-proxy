// Banc de poser-cartes-tcgdex.js (decider) et de poser-par-nom-tcgdex.js (designer) — fonctions pures, aucune base, aucun clone.
//   node test-poser-cartes-tcgdex.js
'use strict';
process.argv = process.argv.slice(0, 2);         // les deux modules ne lisent leur ligne de commande que lancés, jamais importés
const { decider } = require('./poser-cartes-tcgdex');
const { designer } = require('./poser-par-nom-tcgdex');
let echecs = 0, faites = 0;
const verif = (cond, quoi) => { faites++; if (!cond) echecs++; console.log(`${cond ? '✅' : '🔴'} ${quoi}`); };

const S = { _id: 'XY', tirage: 'intl', region: 'intl', bulba: { expansion: 'XY' } };
const imp = (numero, expansion = 'XY') => ({ tirage: 'intl', expansion, numero });
const carteT = (o = {}) => ({ dossier: 'd/xy1', localId: '85', en: 'Aegislash', dex: [681], tcgdexId: 'xy1-85', ids: [449258], ...o });
const ctxDe = ({ cartesT = [carteT()], lies = ['d/xy1'], sets = [S], pont = {}, tenues = {} } = {}) => {
    const parId = new Map(); for (const c of cartesT) for (const id of c.ids || []) (parId.get(id) || parId.set(id, []).get(id)).push(c);
    const parDossier = new Map(); for (const c of cartesT) (parDossier.get(c.dossier) || parDossier.set(c.dossier, []).get(c.dossier)).push(c);
    return { lie: () => new Set(lies), parId, parDossier, setDe: () => sets, pont: id => pont[id] || [], tenues: (t, e, k) => tenues[`${t}|${e}|${k}`] || [] };
};
const p = (o = {}) => ({ idProduct: 449258, idExpansion: 1582, name: 'Aegislash [Stance Change | Buster Swing]', numero: '85', ...o });
const C = { _id: 186881, nomEn: 'Aegislash', impressions: [imp('85')] };

// ── decider
let d = decider(p(), ctxDe({ pont: { 'xy1-85': [C] }, tenues: { 'intl|XY|85': [C] } }));
verif(d.geste === 'pont' && d.C._id === 186881 && d.numeroFiche === '85', `1. pont vers UNE carte qui a l'impression du set au numéro, même nom → joint (${d.geste ?? d.refus})`);
d = decider(p(), ctxDe({ pont: { 'xy1-85': [{ ...C, nomEn: 'Doublade' }] }, tenues: { 'intl|XY|85': [C] } }));
verif(!!d.refus && /nom différent/.test(d.refus), `2. pont vers une carte d'un AUTRE nom → refus (${d.refus})`);
d = decider(p(), ctxDe({ pont: { 'xy1-85': [{ ...C, impressions: [imp('86')] }] } }));
verif(!!d.refus && /n'a pas l'impression/.test(d.refus), `3. pont vers une carte SANS l'impression de ce set à ce numéro → refus (${d.refus})`);
d = decider(p(), ctxDe({ tenues: { 'intl|XY|85': [C] } }));
verif(d.geste === 'impression' && d.C._id === 186881, `4. sans pont, une seule carte tient le numéro, même nom → joint par l'impression (${d.geste ?? d.refus})`);
d = decider(p(), ctxDe({ tenues: { 'intl|XY|85': [{ ...C, _id: 1, nomEn: 'Honedge' }] } }));
verif(!!d.refus && /contradiction de nom/.test(d.refus), `5. le numéro est tenu par une carte d'un autre nom → refus (${d.refus})`);
d = decider(p(), ctxDe({ tenues: { 'intl|XY|85': [C, { ...C, _id: 2 }] } }));
verif(!!d.refus && /tenu par 2 cartes/.test(d.refus), `6. le numéro est tenu par deux cartes → refus (${d.refus})`);
d = decider(p(), ctxDe());
verif(d.geste === 'fiche' && d.numeroFiche === '85', `7. aucune carte ne tient le numéro → fiche TCGdex (${d.geste ?? d.refus})`);
d = decider(p(), ctxDe({ lies: ['d/autre'] }));
verif(!!d.refus && /que rien ne relie/.test(d.refus), `8. idProduct porté par la carte d'un set NON relié à l'expansion → refus (${d.refus})`);
d = decider(p({ name: 'Honedge [Pierce]' }), ctxDe());
verif(!!d.refus && /CONTRE/.test(d.refus), `9. témoin du nom CONTRE (nom TCGdex ≠ nom du produit) → refus (${d.refus})`);
d = decider(p(), ctxDe({ cartesT: [carteT({ en: null, dex: [] })] }));
verif(!!d.refus && /MUET/.test(d.refus), `10. témoin MUET (ni nom anglais ni Pokédex) → refus (${d.refus})`);
d = decider(p({ numero: '86' }), ctxDe());
verif(!!d.refus && /≠ numéro TCGdex/.test(d.refus), `11. numéro appris ≠ numéro TCGdex → refus (${d.refus})`);
d = decider(p(), ctxDe({ sets: [S, { ...S, _id: 'XY-bis' }] }));
verif(!!d.refus && /2 sets/.test(d.refus), `12. deux sets portent l'expansion → refus (${d.refus})`);
d = decider(p(), ctxDe({ cartesT: [carteT(), carteT({ dossier: 'd/xy1', localId: '85b', tcgdexId: 'xy1-85b' })] }));
verif(!!d.refus && /2 cartes TCGdex portent/.test(d.refus), `13. deux cartes TCGdex portent l'idProduct → refus (${d.refus})`);
d = decider(p({ name: 'Fighting Energy', idProduct: 7 }), ctxDe({ cartesT: [carteT({ en: 'Fighting Energy', ids: [7], tcgdexId: 'xy1-85' })], pont: { 'xy1-85': [{ ...C, nomEn: 'Basic Fighting Energy' }] }, tenues: { 'intl|XY|85': [{ ...C, nomEn: 'Basic Fighting Energy' }] } }));
verif(d.geste === 'pont', `14. « Fighting Energy » = « Basic Fighting Energy » (clé de nom de la jointure) → joint (${d.geste ?? d.refus})`);

// (relecture du 2026-10-07) un numéro de NOTRE page qui porte une position ou un reste de wikitext : la carte doit être vue (joint), pas
// doublée par une fiche — 6 fiches en double le 2026-10-07 (V-UNION « SWSH139 (Top Left) », Oddish « 102<!-- »)
const { numeroNu } = require('./poser-cartes-tcgdex');
verif(numeroNu('SWSH139 (Top Left)') === 'SWSH139' && numeroNu('102<!--') === '102' && numeroNu('55a') === '55a', `15a. numeroNu retire la position et le commentaire, garde « 55a » (${numeroNu('SWSH139 (Top Left)')}, ${numeroNu('102<!--')})`);
const CV = { _id: 263328, nomEn: 'Pikachu V-UNION', impressions: [imp('SWSH139 (Top Left)')] };
d = decider(p({ name: 'Pikachu V-UNION [Oversized]', numero: 'SWSH139', idProduct: 8 }), ctxDe({ cartesT: [carteT({ en: 'Pikachu V-UNION', localId: 'SWSH139', ids: [8], tcgdexId: 'swshp-SWSH139' })], pont: { 'swshp-SWSH139': [CV] }, tenues: { 'intl|XY|SWSH139': [CV] } }));
verif(d.geste === 'pont' && d.numeroFiche === 'SWSH139 (Top Left)', `15b. V-UNION « SWSH139 (Top Left) » chez nous : joint à la carte, pas de fiche (${d.geste ?? d.refus})`);

// ── designer (clé par le nom)
const tC = (localId, en) => ({ dossier: 'd/xy1', localId, en, dex: [], tcgdexId: `xy1-${localId}` });
const ctxN = ({ cartesT, base }) => {
    const parDossier = new Map([['d/xy1', cartesT]]);
    return { lies: () => new Set(['d/xy1']), parDossier, setDe: () => [S], cartesDuSet: () => base };
};
const q = (name) => ({ idProduct: 9, idExpansion: 1582, name });
let n = designer(q('Lysandre'), ctxN({ cartesT: [tC('137', 'Lysandre')], base: [{ carte: { _id: 5, nomEn: 'Lysandre' }, numero: '137' }] }));
verif(n.C?._id === 5 && n.numeroFiche === '137', `15. un seul numéro chez TCGdex, une seule carte chez nous au même numéro → joint (${n.refus ?? 'joint'})`);
n = designer(q('Lysandre'), ctxN({ cartesT: [tC('137', 'Lysandre')], base: [{ carte: { _id: 5, nomEn: 'Lysandre' }, numero: '138' }] }));
verif(!!n.refus && /désaccord/.test(n.refus), `16. les deux sources donnent deux numéros → refus (${n.refus})`);
n = designer(q('Lysandre'), ctxN({ cartesT: [tC('137', 'Lysandre'), tC('146', 'Lysandre')], base: [{ carte: { _id: 5, nomEn: 'Lysandre' }, numero: '137' }] }));
verif(!!n.refus && /plusieurs numéros/.test(n.refus), `17. le nom porte deux numéros chez TCGdex (réimpression, secrète) → refus (${n.refus})`);
n = designer(q('Hippowdon [4] Lv.52 [Sand Armor | Bite and Crush]'), ctxN({ cartesT: [tC('25', 'Hippowdon')], base: [{ carte: { _id: 7, nomEn: 'Hippowdon' }, numero: '25' }] }));
verif(!!n.refus && /marque de version/.test(n.refus), `18. une marque de version entre crochets (« [4] ») → la clé se tait (${n.refus})`);
n = designer(q('Lysandre'), ctxN({ cartesT: [tC('137', 'Lysandre')], base: [{ carte: { _id: 5, nomEn: 'Lysandre' }, numero: '137' }, { carte: { _id: 6, nomEn: 'Lysandre' }, numero: '137' }] }));
verif(!!n.refus && /plusieurs cartes/.test(n.refus), `19. deux cartes de ce nom chez nous dans le set → refus (${n.refus})`);

console.log(`\n${echecs ? `🔴 ${echecs} échec(s)` : '✅ tout passe'} sur ${faites} vérifications`);
process.exit(echecs ? 1 : 0);
