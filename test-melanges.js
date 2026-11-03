// node test-melanges.js — produits qui MÉLANGENT plusieurs versions et variantes indiscernables (collecte-cartes/melanges.js, décisions du testeur du 2026-11-01).
// Fonctions PURES : aucune base, aucun fichier, aucune requête. Les fixtures reprennent la FORME des documents lus en base le 2026-11-01 (sonde en lecture seule).
const M = require('./collecte-cartes/melanges');
const MQ = require('./collecte-cartes/marqueurs-etiquettes');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const types = c => c.marqueurs.map(m => m.type);

// ── 0. le type FINITION_NON_VISIBLE existe au contrat de l'API (livré le 31/10) : il est valide ici, en dernier
verifier('contrat : FINITION_NON_VISIBLE est un marqueur valide', MQ.valide({ type: 'FINITION_NON_VISIBLE', params: {} }), true);
verifier('contrat : FINITION_NON_VISIBLE est le DERNIER de l\'ordre (table du §3)', MQ.ORDRE[MQ.ORDRE.length - 1], 'FINITION_NON_VISIBLE');
verifier('contrat : un type inventé reste invalide', MQ.valide({ type: 'MELANGE', params: {} }), false);

// ── 1. mélanges de tampons : lignes lues (forme de cartes_produits)
const T = '2026-10-18';
const ligne = (idProduct, slugSet, connus, preuves, extra = {}) => ({ _id: `1|${idProduct}`, carteId: 1, idProduct, slugSet, numeroFiche: '115', prixMelangeTampon: true, tamponsConnus: connus, prixMelangeTamponPreuve: preuves, ...extra });
const guzma = ligne(449623, 'Burning-Shadows', ['championship', 'staff'], [`relevé du testeur, ${T} (idProduct 449623, « Staff + Championship »)`]);
let r = M.planMelangesTampons({ lignes: [guzma] });
verifier('mélange : Guzma (relevé du testeur : Staff + Championship) → STAFF + CHAMPIONSHIP', r.cibles.map(types), [['STAFF', 'CHAMPIONSHIP']]);
verifier('mélange : le libellé voulu tient en 40 caractères (FR et EN)', r.cibles.map(c => [c.libelle.fr.length <= 40, c.libelle.en.length <= 40]), [[true, true]]);
verifier('mélange : le libellé FR de Guzma', r.cibles[0].libelle.fr, "Staff ou Championship selon l'exemplaire");
verifier('mélange : la preuve cite le libellé voulu et ne nomme aucune source', [/Staff ou Championship selon l'exemplaire/.test(r.cibles[0].preuve), /tcgplayer|tcgcsv|cardmarket|tcgdex|bulbapedia|pokumon/i.test(r.cibles[0].preuve)], [true, false]);
verifier('mélange : les marqueurs sont dans l\'ordre du contrat et valides', r.cibles[0].marqueurs.every(MQ.valide), true);

const xy86 = ligne(281423, 'XY', ['prerelease', 'staff-prerelease'], ['lecture A : prerelease (set+numero+nom)', 'lecture B : staff-prerelease (set+numero+nom)']);
r = M.planMelangesTampons({ lignes: [xy86] });
verifier('mélange : prerelease + staff-prerelease sur DEUX lectures sans relevé du testeur → refus (deux tampons existent, pas que CE produit les mélange)', [r.cibles.length, r.refus.map(x => x.raison)], [0, ['deux-tampons-connus-melange-non-prouve']]);
r = M.planMelangesTampons({ lignes: [{ ...xy86, prixMelangeTamponPreuve: ['relevé du testeur, 2026-10-18 (« Prerelease + Staff »)'] }] });
verifier('mélange : le même produit avec un relevé du testeur → STAFF + PRERELEASE', r.cibles.map(types), [['STAFF', 'PRERELEASE']]);
verifier('mélange : un libellé trop long retombe sur la forme courte (≤ 40)', r.cibles.map(c => [c.libelle.fr, c.libelle.fr.length <= 40]), [['Staff ou Avant-première (selon copie)', true]]);

const unSeulTemoin = ligne(817301, 'Journey-Together', ['league', 'staff'], ['une seule lecture : league+staff']);
verifier('mélange : une SEULE lecture (ni relevé du testeur ni deux lectures) → refus', M.planMelangesTampons({ lignes: [unSeulTemoin] }).refus.map(x => x.raison), ['deux-tampons-connus-melange-non-prouve']);
const avecAutre = ligne(360556, 'SM-Black-Star-Promos', ['autre', 'staff'], [`relevé du testeur, ${T} (« Staff + Autre »)`]);
verifier('mélange : un tampon « autre » n\'a pas de type au contrat → refus (jamais deviné)', M.planMelangesTampons({ lignes: [avecAutre] }).refus.map(x => x.raison), ['tampon-sans-type']);
const unSeul = ligne(608696, 'Brilliant-Stars', ['staff'], ['a', 'b']);
verifier('mélange : un seul tampon connu = mélange avec l\'ordinaire → refus (décision à prendre)', M.planMelangesTampons({ lignes: [unSeul] }).refus.map(x => x.raison), ['un-seul-tampon-connu']);
verifier('mélange : une ligne sans prixMelangeTampon n\'est pas un mélange', M.planMelangesTampons({ lignes: [{ ...guzma, prixMelangeTampon: undefined }] }).cibles.length, 0);

// ── 2. WCD indiscernables : année de l'expansion + NON_LEGAL + FINITION_NON_VISIBLE
const wcd = (id, slugSet, carteId) => ({ _id: `${carteId}|${id}`, carteId, idProduct: id, slugSet });
r = M.planFinitionWcd({ lignes: [wcd(868202, 'WCD-2011', 108512), wcd(868203, 'WCD-2011', 108512), wcd(869299, 'WCD-2008', 25184), wcd(869300, 'WCD-2008', 25184), wcd(869301, 'WCD-2008', 25184), wcd(869302, 'WCD-2008', 25184)] });
verifier('WCD : liste fermée de 4 produits nommés ; Celio\'s V3/V4 (869301, 869302) ne sont PAS marqués faute de preuve qu\'on ne peut pas les distinguer', r.cibles.map(c => c.idProduct), [868202, 868203, 869299, 869300]);
verifier('WCD : produits indiscernables → WCD{année} + NON_LEGAL + FINITION_NON_VISIBLE', r.cibles.slice(0, 4).map(c => [c.idProduct, c.marqueurs]), [
    [868202, [{ type: 'WCD', params: { annee: 2011 } }, { type: 'NON_LEGAL', params: {} }, { type: 'FINITION_NON_VISIBLE', params: {} }]],
    [868203, [{ type: 'WCD', params: { annee: 2011 } }, { type: 'NON_LEGAL', params: {} }, { type: 'FINITION_NON_VISIBLE', params: {} }]],
    [869299, [{ type: 'WCD', params: { annee: 2008 } }, { type: 'NON_LEGAL', params: {} }, { type: 'FINITION_NON_VISIBLE', params: {} }]],
    [869300, [{ type: 'WCD', params: { annee: 2008 } }, { type: 'NON_LEGAL', params: {} }, { type: 'FINITION_NON_VISIBLE', params: {} }]]]);
verifier('WCD : une ligne dont le set n\'est pas celui de la liste → refus', M.planFinitionWcd({ lignes: [wcd(868202, 'WCD-2012', 108512)] }).refus.filter(x => x.idProduct === 868202).map(x => x.raison), ['ligne-differente-de-la-liste']);
verifier('WCD : une ligne absente → refus nommé', M.planFinitionWcd({ lignes: [] }).refus.length, 4);

// ── 3. l'écriture des marqueurs passe par la garde existante (planifierEcriture) : on n'écrase jamais
const ecr = M.planFinitionWcd({ lignes: [wcd(868202, 'WCD-2011', 108512)] });
const plan = MQ.planifierEcriture({ cibles: ecr.cibles, lignes: [{ ...wcd(868202, 'WCD-2011', 108512), marqueurs: [{ type: 'JUMBO', params: {} }] }], exportIds: new Set([868202]) });
verifier('écriture : des marqueurs déjà présents ne sont jamais écrasés', [plan.ecrire.length, plan.refus.length], [0, 1]);

// ── 4. emprunts : le visuel de base, empruntée, jamais un scan d'une autre version
const orig = (set, numero, cleR2, extra = {}) => ({ set, numero, cleR2, source: 'tcgdex', langue: 'en', w: 600, h: 825, vignette: { cleR2: 'v/' + cleR2 }, ...extra });
const carteG = { _id: 223420, images: [orig('Burning-Shadows', '115', 'tcgdex/Burning-Shadows/115-223420.webp'), orig('Burning-Shadows', '143', 'tcgdex/Burning-Shadows/143-223420.webp')] };
const lg = (extra = {}) => ({ _id: '223420|449623', carteId: 223420, idProduct: 449623, slugSet: 'Burning-Shadows', numeroFiche: '115a', ...extra });
const maintenant = new Date('2026-11-01T20:00:00Z');
const ent = [M.LISTE_EMPRUNTS.find(e => e.produits.includes(449623))];
let p = M.planEmprunts({ lignes: [lg()], cartes: new Map([[223420, carteG]]), entrees: ent, maintenant });
verifier('emprunt : Guzma 115a reçoit le visuel de base (115) en EMPRUNTÉ, tampon non représenté', p.ajouts.map(a => [a.set, a.numero, a.entree.cleR2, a.entree.imageEmprunteeTirage, a.entree.source, a.entree.tamponNonRepresente, a.entree.lot, a.entree.retirable]), [['Burning-Shadows', '115a', 'tcgdex/Burning-Shadows/115-223420.webp', true, 'emprunt', 'Staff ou Championship', M.LOT, true]]);
verifier('emprunt : l\'entrée reprend langue, taille et vignette de l\'origine', p.ajouts.map(a => [a.entree.langue, a.entree.w, a.entree.h, a.entree.vignette]), [['en', 600, 825, { cleR2: 'v/tcgdex/Burning-Shadows/115-223420.webp' }]]);
verifier('emprunt : numeroFiche encore null → refus (corriger le numéro d\'abord)', M.planEmprunts({ lignes: [lg({ numeroFiche: null })], cartes: new Map([[223420, carteG]]), entrees: ent, maintenant }).refus.map(x => x.raison), ['numero-fiche-different-de-la-liste']);
verifier('emprunt : une entrée 115a déjà présente couvre la ligne (jamais touchée)', M.planEmprunts({ lignes: [lg()], cartes: new Map([[223420, { ...carteG, images: [...carteG.images, orig('Burning-Shadows', '115a', 'pkmncards/x.webp')] }]]), entrees: ent, maintenant }).deja.length, 1);
verifier('emprunt : une entrée au numéro 115 ne couvre PAS la ligne 115a (la lettre compte)', M.planEmprunts({ lignes: [lg()], cartes: new Map([[223420, carteG]]), entrees: ent, maintenant }).deja.length, 0);
verifier('emprunt : un frère au MÊME numéro (115a) hors liste → refus', M.planEmprunts({ lignes: [lg(), { _id: '223420|1', carteId: 223420, idProduct: 1, slugSet: 'Burning-Shadows', numeroFiche: '115a' }], cartes: new Map([[223420, carteG]]), entrees: ent, maintenant }).refus.map(x => x.raison.slice(0, 18)), ['frere-hors-liste (']);
verifier('emprunt : une ligne SANS numéro de fiche ne reçoit pas une entrée numérotée (l\'API ne lie un numéro qu\'à une entrée du même numéro) → pas un frère', M.planEmprunts({ lignes: [lg(), { _id: '223420|1', carteId: 223420, idProduct: 1, slugSet: 'Burning-Shadows', numeroFiche: null }], cartes: new Map([[223420, carteG]]), entrees: ent, maintenant }).ajouts.length, 1);
verifier('emprunt : un produit d\'un AUTRE numéro du même set n\'est pas un frère (143 reste à lui)', M.planEmprunts({ lignes: [lg(), { _id: '223420|2', carteId: 223420, idProduct: 2, slugSet: 'Burning-Shadows', numeroFiche: '143' }], cartes: new Map([[223420, carteG]]), entrees: ent, maintenant }).ajouts.length, 1);
verifier('emprunt : origine absente de la carte → refus', M.planEmprunts({ lignes: [lg()], cartes: new Map([[223420, { _id: 223420, images: [] }]]), entrees: ent, maintenant }).refus.map(x => x.raison), ['origine-absente-ou-ambigue']);
verifier('emprunt : origine sans langue → refus (le site refuse un visuel sans langue)', M.planEmprunts({ lignes: [lg()], cartes: new Map([[223420, { _id: 223420, images: [orig('Burning-Shadows', '115', 'tcgdex/Burning-Shadows/115-223420.webp', { langue: null })] }]]), entrees: ent, maintenant }).refus.map(x => x.raison), ['origine-sans-langue-ou-taille']);
verifier('emprunt : la ligne n\'est pas celle de la liste (autre carte) → refus', M.planEmprunts({ lignes: [lg({ carteId: 5 })], cartes: new Map([[223420, carteG]]), entrees: ent, maintenant }).refus.map(x => x.raison), ['ligne-differente-de-la-liste']);

// WCD : deux produits, une entrée (carte, set), motif autre-tirage (admission B de l'API), pas de tampon
const entW = [M.LISTE_EMPRUNTS.find(e => e.produits.includes(868202))];
const carteT = { _id: 108512, images: [orig('Triumphant', '89', 'tcgdex/Triumphant/89-108512.webp')] };
p = M.planEmprunts({ lignes: [wcd(868202, 'WCD-2011', 108512), wcd(868203, 'WCD-2011', 108512)], cartes: new Map([[108512, carteT]]), entrees: entW, maintenant });
verifier('emprunt WCD : UNE entrée pour les deux produits, motif autre-tirage, sans numéro', p.ajouts.map(a => [a.set, a.numero, a.produits, a.entree.differenceEmprunt, a.entree.tamponNonRepresente ?? null]), [['WCD-2011', null, [868202, 868203], 'autre-tirage', null]]);
verifier('emprunt WCD : une ligne sans numéro du même set hors liste reçoit l\'entrée sans numéro → refus (frère)', M.planEmprunts({ lignes: [wcd(868202, 'WCD-2011', 108512), wcd(868203, 'WCD-2011', 108512), wcd(7, 'WCD-2011', 108512)], cartes: new Map([[108512, carteT]]), entrees: entW, maintenant }).refus.map(x => x.freres), [[7]]);
verifier('emprunt WCD : la langue de preuve est celle des WCD empruntés', p.ajouts[0].entree.languePreuve.startsWith('visuel d\'un autre tirage emprunté'), true);

// les opérations Mongo : $push gardé, jamais un $set de tableau ; retrait exact par le lot
const ops = M.operationsEmprunts(p);
verifier('opérations : un $push gardé par (set, numéro)', [ops.length, Object.keys(ops[0].update), JSON.stringify(ops[0].filter.images)], [1, ['$push'], JSON.stringify({ $not: { $elemMatch: { set: 'WCD-2011' } } })]);
verifier('retrait : $pull restreint au lot, à la source et à la clé', Object.keys(M.operationsRetrait(M.manifeste(p))[0].update.$pull.images).sort(), ['cleR2', 'imageEmprunteeTirage', 'lot', 'numero', 'set', 'source']);

// ── 5. numéro de fiche de Guzma : null → 115a, avec preuve, jamais d'écrasement
const nf = M.planNumeroFiche({ lignes: [lg({ numeroFiche: null })], appris: new Map([[449623, { slug: 'Guzma-V4-BUS115a', numero: '115a' }]]) });
verifier('numeroFiche : null → 115a quand le produit porte lui-même ce numéro (slug et numéro appris)', nf.ecrire.map(x => [x.idProduct, x.numeroFiche]), [[449623, '115a']]);
verifier('numeroFiche : un numéro déjà posé n\'est jamais écrasé', M.planNumeroFiche({ lignes: [lg({ numeroFiche: '115' })], appris: new Map([[449623, { slug: 'Guzma-V4-BUS115a', numero: '115a' }]]) }).refus.filter(x => x.idProduct === 449623).map(x => x.raison), ['numero-deja-pose']);
verifier('numeroFiche : le slug ne dit pas 115a → refus', M.planNumeroFiche({ lignes: [lg({ numeroFiche: null })], appris: new Map([[449623, { slug: 'Guzma-V4-BUS115', numero: '115' }]]) }).refus.filter(x => x.idProduct === 449623).map(x => x.raison), ['numero-appris-different']);
verifier('numeroFiche : produit non appris → refus', M.planNumeroFiche({ lignes: [lg({ numeroFiche: null })], appris: new Map() }).refus.filter(x => x.idProduct === 449623).map(x => x.raison), ['produit-non-appris']);

// ── 6. les « a/b » : 10 produits dont la carte porte DÉJÀ le scan du numéro appris (fiche annexe du site, lib/annexes.json), numeroFiche null → numéro appris (2026-11-03, rejeu de la règle du site)
const YA = [[358590, 221222, 'SM-Black-Star-Promos', 'SM30a', 'Tapu-Koko-V3-SMSM30a'], [475134, 236775, 'Unified-Minds', '206a', 'Reset-Stamp-V3-UNM206a'], [475144, 87404, 'Unbroken-Bonds', '182b', 'Pokegear-30-V4-UNB182b'],
    [475149, 234576, 'Unbroken-Bonds', '195a', 'Dedenne-GX-V4-UNB195a'], [365544, 219810, 'Guardians-Rising', '92a', 'Sylveon-GX-V4-GRI92a'], [450878, 221756, 'Guardians-Rising', '157a', 'Metagross-GX-V4-GRI157a'],
    [475139, 87405, 'Team-Up', '152b', 'Pokemon-Communication-V3-TEU152b'], [562701, 230075, 'Celestial-Storm', '148a', 'Tate-Liza-V3'], [450888, 224190, 'Shining-Legends', '77a', 'Zoroark-GX-V3-SLG77a'], [321006, 224120, 'Shining-Legends', '10a', 'Entei-GX-V4-SLG10a']];
verifier('numeroFiche a/b : la liste fermée porte Guzma + les 10 produits prouvés, gelée', [Object.keys(M.NUMEROS_FICHE).length, YA.every(([id]) => M.NUMEROS_FICHE[id] && Object.isFrozen(M.NUMEROS_FICHE[id])), Object.isFrozen(M.NUMEROS_FICHE)], [11, true, true]);
verifier('numeroFiche a/b : chaque entrée garde carte, set et numéro de la preuve', YA.map(([id, carteId, set, num]) => { const e = M.NUMEROS_FICHE[id]; return !!e && e.carteId === carteId && e.slugSet === set && e.numeroFiche === num; }), YA.map(() => true));
const ligneYA = (id, carteId, set, extra = {}) => ({ _id: `${carteId}|${id}`, carteId, idProduct: id, slugSet: set, numeroFiche: null, preuve: 'metacarte+freres', ...extra });
const planYA = YA.map(([id, carteId, set, num, slug]) => M.planNumeroFiche({ lignes: [ligneYA(id, carteId, set)], appris: new Map([[id, { slug, numero: num }]]) }));
verifier('numeroFiche a/b : null → numéro appris pour les 10 (un plan par produit, une seule écriture de la liste concernée)', YA.map(([id], i) => planYA[i].ecrire.filter(x => x.idProduct === id).map(x => x.numeroFiche)), YA.map(([, , , num]) => [num]));
const yEntei = YA.find(y => y[0] === 321006), yTate = YA.find(y => y[0] === 562701);
verifier('numeroFiche a/b : Entei, le slug appris sans la lettre (SLG10) → refus', M.planNumeroFiche({ lignes: [ligneYA(321006, 224120, 'Shining-Legends')], appris: new Map([[321006, { slug: 'Entei-GX-V4-SLG10', numero: '10' }]]) }).refus.filter(x => x.idProduct === 321006).map(x => x.raison), ['numero-appris-different']);
verifier('numeroFiche a/b : Entei, un numéro déjà posé n\'est jamais écrasé', M.planNumeroFiche({ lignes: [ligneYA(321006, 224120, 'Shining-Legends', { numeroFiche: '10' })], appris: new Map([[321006, { slug: yEntei[4], numero: '10a' }]]) }).refus.filter(x => x.idProduct === 321006).map(x => x.raison), ['numero-deja-pose']);
verifier('numeroFiche a/b : Tate & Liza (slug sans numéro) → refus si le numéro appris n\'est pas 148a', M.planNumeroFiche({ lignes: [ligneYA(562701, 230075, 'Celestial-Storm')], appris: new Map([[562701, { slug: yTate[4], numero: '148' }]]) }).refus.filter(x => x.idProduct === 562701).map(x => x.raison), ['numero-appris-different']);
verifier('numeroFiche a/b : une ligne d\'une autre carte que celle de la liste → refus', M.planNumeroFiche({ lignes: [ligneYA(321006, 5, 'Shining-Legends')], appris: new Map([[321006, { slug: yEntei[4], numero: '10a' }]]) }).refus.filter(x => x.idProduct === 321006).map(x => x.raison), ['ligne-differente-de-la-liste']);
verifier('numeroFiche a/b : produit non appris → refus', M.planNumeroFiche({ lignes: [ligneYA(321006, 224120, 'Shining-Legends')], appris: new Map() }).refus.filter(x => x.idProduct === 321006).map(x => x.raison), ['produit-non-appris']);

console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
process.exit(ko ? 1 : 0);
