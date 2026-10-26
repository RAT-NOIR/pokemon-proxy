// node test-poser-confirmations.js — poser-confirmations.js (B1, 2026-10-26) : le plan est REJOUÉ avec les fonctions de production, l'écriture est additive (un seul champ), sous lot-additif, jamais sans --attendu.
// Bancs sur FAUX : aucune base, aucune requête. Les écritures sont espionnées ; la simulation n'en fait aucune.
const P = require(process.env.POSER_MODULE || './poser-confirmations');   // la variable ne sert qu'à collecte-cartes/test-mutation-confirmation.js
const { cleNumero } = require('./collecte-cartes/jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const LE = new Date('2026-10-26T12:00:00Z');

// ── un monde fabriqué : produit 11 « Water Energy » n°103 du set EX-Emerald, joint par set+nom à la carte 7, qui porte le n°103
const CARTE = { _id: 7, nomEn: 'Water Energy', niveau: null, attaques: [], impressions: [{ numero: '103', tirage: 'intl', expansion: 'EX Emerald' }, { numero: '7', tirage: 'intl', expansion: 'Autre Set' }], sets: ['EX-Emerald'] };
const AUTRE = { _id: 8, nomEn: 'Fire Energy', niveau: null, attaques: [], impressions: [{ numero: '104' }], sets: ['EX-Emerald'] };
const LIGNE = { _id: '7|11', carteId: 7, idProduct: 11, idExpansion: 1547, preuve: 'set+nom', slugSet: 'EX-Emerald', numeroFiche: null, tirage: 'intl' };
const PRODUIT = { idProduct: 11, idExpansion: 1547, set: 'EX-Emerald', numero: '103', name: 'Water Energy' };
const CONC = { source: 'tcgdex', ref: 'ex9-103', set: 'EX-Emerald', numero: '103', nom: 'Water Energy', par: 'nom' };
const entree = (o = {}) => ({ idProduct: 11, carteId: 7, concordantes: [CONC], refusees: [], ...o });
const monde = (o = {}) => ({
    lignes: new Map([[11, [LIGNE]]]), produits: new Map([[11, PRODUIT]]), cartes: new Map([[7, CARTE]]),
    cartesDuSet: slug => [CARTE, AUTRE].filter(c => c.sets.includes(slug)), sets: new Map([['EX-Emerald', { _id: 'EX-Emerald', bulba: { expansion: 'EX Emerald' } }]]), ...o });
const plan = (e, m) => P.planifier({ entrees: [e], lecture: m || monde(), le: LE });
const raison = r => r.refus[0]?.raison ?? null;

// ── le cas qui passe
const p0 = plan(entree());
verifier('un produit confirmé, joint par le nom seul, dont la carte porte le numéro : 1 confirmation à poser', [p0.ecrire.length, p0.refus.length, p0.deja.length], [1, 0, 0]);
verifier('la confirmation posée : sources, valeurs, carte, instrument, date', { s: p0.ecrire[0].confirmation.sources, v: p0.ecrire[0].confirmation.valeurs, c: p0.ecrire[0].confirmation.carteId, le: p0.ecrire[0].confirmation.le.toISOString(), i: /poser-confirmations/.test(p0.ecrire[0].confirmation.instrument) }, { s: ['cardmarket', 'tcgdex'], v: { set: 'EX-Emerald', numero: '103', nom: 'Water Energy' }, c: 7, le: '2026-10-26T12:00:00.000Z', i: true });
verifier('le plan nomme la ligne par son _id', p0.ecrire[0]._id, '7|11');

const CP = { ...CARTE, nomEn: 'Pikachu' }, CONCP = { ...CONC, nom: 'Pikachu' };
const monP = (carte, o = {}) => monde({ produits: new Map([[11, { ...PRODUIT, name: 'Pikachu' }]]), cartes: new Map([[7, carte]]), cartesDuSet: () => [carte], ...o });
const plP = (carte, o) => plan(entree({ concordantes: [CONCP] }), monP(carte, o));
// ── les refus (une garde s'écrit par ce qu'elle autorise : chaque cas doit être refusé, nommé)
const refuse = (nom, p, motif) => verifier(`refus : ${nom}`, [p.ecrire.length, p.refus.length, motif.test(raison(p))], [0, 1, true]);
refuse('le produit n\'a aucune ligne', plan(entree(), monde({ lignes: new Map() })), /aucune ligne/);
refuse('le produit a deux lignes (deux cartes)', plan(entree(), monde({ lignes: new Map([[11, [LIGNE, { ...LIGNE, _id: '8|11', carteId: 8 }]]]) })), /lignes/);
refuse('la ligne désigne une autre carte que celle des sources (la carte 8 existe, identique : seule la comparaison de carteId l\'arrête)', plan(entree({ carteId: 8 }), monde({ cartes: new Map([[7, CARTE], [8, { ...CARTE, _id: 8 }]]), cartesDuSet: () => [CARTE, { ...CARTE, _id: 8 }] })), /carte/);
refuse('la preuve de la ligne n\'est pas faible (le numéro l\'établit déjà)', plan(entree(), monde({ lignes: new Map([[11, [{ ...LIGNE, preuve: 'set+numero' }]]]) })), /preuve/);
refuse('une ligne sans preuve écrite : inconnue, pas faible', plan(entree(), monde({ lignes: new Map([[11, [{ ...LIGNE, preuve: undefined }]]]) })), /preuve/);
refuse('produit absent du catalogue', plan(entree(), monde({ produits: new Map() })), /produit/);
refuse('produit sans numéro Cardmarket appris', plan(entree(), monde({ produits: new Map([[11, { ...PRODUIT, numero: null }]]) })), /numéro/);
refuse('produit sans set appris', plan(entree(), monde({ produits: new Map([[11, { ...PRODUIT, set: null }]]) })), /set/);
refuse('le numéro du produit a changé depuis le relevé : les sources ne concordent plus (juger rejoué)', plan(entree(), monde({ produits: new Map([[11, { ...PRODUIT, numero: '104' }]]) })), /deux sources|concord/);
refuse('le nom du produit a changé depuis le relevé', plan(entree(), monde({ produits: new Map([[11, { ...PRODUIT, name: 'Fire Energy' }]]) })), /deux sources|concord/);
refuse('une seule source indépendante absente : aucune concordante', plan(entree({ concordantes: [] })), /deux sources|concord/);
refuse('la seule seconde source est Bulbapedia', plan(entree({ concordantes: [{ ...CONC, source: 'bulbapedia' }] })), /deux sources|concord/);
refuse('un relevé LISIBLE d\'une autre source dit un autre nom au même numéro : contradiction', plan(entree({ refusees: [{ source: 'artofpkm', ref: 'r', raison: 'nom discordant (« Fire Energy » / « Water Energy »)' }] })), /contradi/);
refuse('la carte ne porte pas ce numéro (la ligne ne désigne pas la carte des sources)', plP({ ...CP, impressions: [{ numero: '99', expansion: 'EX Emerald' }] }), /carte-sans-impression-du-set/);
refuse('la carte est absente de la base', plan(entree(), monde({ cartes: new Map() })), /carte/);
refuse('la carte n\'a pas de nom : le témoin du nom est muet, je ne conclus pas', plan(entree(), monde({ cartes: new Map([[7, { ...CARTE, nomEn: null }]]) })), /témoin/);
refuse('le témoin du nom désigne une autre carte du set pour ce produit', plan(entree(), monde({ cartes: new Map([[7, { ...CARTE, nomEn: 'Grass Energy' }]]), cartesDuSet: () => [{ ...CARTE, nomEn: 'Grass Energy' }, { _id: 9, nomEn: 'Water Energy', impressions: [], attaques: [], sets: ['EX-Emerald'] }] })), /nom de la carte|témoin/);
// l'équivalence des zéros de tête (cleNumero de production) : « 016 » et « 16 » sont le même numéro
verifier('cleNumero est celui de production (016 = 16)', cleNumero('016'), cleNumero('16'));
verifier('la carte porte « 16 », le produit « 016 » : accepté', plan(entree({ concordantes: [{ ...CONC, numero: '16' }] }), monde({ produits: new Map([[11, { ...PRODUIT, numero: '016' }]]), cartes: new Map([[7, { ...CARTE, impressions: [{ numero: '16', expansion: 'EX Emerald' }] }]]) })).ecrire.length, 1);

// ── tour 1 de la relecture : I1 (le NOM de la carte) et I2 (le numéro est celui du SET de la ligne)
refuse('I1 Scyther/Scizor : la carte de la ligne porte un AUTRE nom que le produit confirmé', plan(entree({ concordantes: [{ ...CONC, nom: 'Scyther' }] }), monde({ produits: new Map([[11, { ...PRODUIT, name: 'Scyther' }]]), cartes: new Map([[7, { ...CARTE, nomEn: 'Scizor' }]]), cartesDuSet: () => [{ ...CARTE, nomEn: 'Scizor' }] })), /nom de la carte/);
verifier('I1 : « Basic Water Energy » (carte) et « Water Energy » (produit) sont le même nom (clésNom de production)', plan(entree(), monde({ cartes: new Map([[7, { ...CARTE, nomEn: 'Basic Water Energy' }]]), cartesDuSet: () => [{ ...CARTE, nomEn: 'Basic Water Energy' }] })).ecrire.length, 1);
refuse('I2 : la carte porte le numéro, mais dans un AUTRE set (aucune impression du set de la ligne)', plP({ ...CP, impressions: [{ numero: '103', expansion: 'Autre Set' }] }), /carte-sans-impression-du-set/);
refuse('I2 : la carte a une impression du set, mais à un autre numéro', plP({ ...CP, impressions: [{ numero: '99', expansion: 'EX Emerald' }, { numero: '103', expansion: 'Autre Set' }] }), /carte-sans-impression-du-set/);
refuse('I2 : le set de la ligne n\'a pas de nom d\'expansion connu : je ne conclus pas', plP(CP, { sets: new Map([['EX-Emerald', { _id: 'EX-Emerald' }]]) }), /carte-sans-impression-du-set/);
refuse('I2 : set absent de la base', plP(CP, { sets: new Map() }), /carte-sans-impression-du-set/);
// ── cas génériques fermés (décision du testeur 26/10) : la carte n'a aucune marque de ce set, mais elle EST ce visuel
const ENERGIE_SANS_SET = monde({ cartes: new Map([[7, { ...CARTE, impressions: [{ numero: '103', expansion: 'Autre Set' }] }]]) });
const pg = plan(entree(), ENERGIE_SANS_SET);
verifier('générique (a) énergie de base sans impression du set : 1 confirmation générique', [pg.ecrire.length, pg.refus.length, pg.ecrire[0]?.confirmation.generique, pg.ecrire[0]?.confirmation.cas, pg.ecrire[0]?.confirmation.marque], [1, 0, true, 'energie-de-base', 'visuel générique, sans marque de set']);
verifier('générique (a) : « Basic Water Energy » accepté aussi', plan(entree(), monde({ cartes: new Map([[7, { ...CARTE, nomEn: 'Basic Water Energy', impressions: [{ numero: '103', expansion: 'Autre Set' }] }]]), cartesDuSet: () => [CARTE] })).ecrire[0]?.confirmation.cas, 'energie-de-base');
verifier('générique (a) : une énergie qui a l\'impression du set n\'est PAS générique (confirmation ordinaire)', [p0.ecrire[0].confirmation.generique, p0.ecrire[0].confirmation.cas], [undefined, undefined]);
const SPEC = { _id: 'Pika-P', nomEn: 'Pikachu', niveau: null, attaques: [], impressions: [{ numero: '5', expansion: 'Autre Set', tirage: 'intl' }], sets: ['SV-P-ZH'] };
const monZh = (tirage, o = {}) => monde({ lignes: new Map([[11, [{ ...LIGNE, slugSet: 'SV-P-ZH', carteId: 'Pika-P' }]]]), produits: new Map([[11, { ...PRODUIT, set: 'SV-P-ZH', name: 'Pikachu' }]]), cartes: new Map([['Pika-P', SPEC]]), cartesDuSet: () => [SPEC], sets: new Map([['SV-P-ZH', { _id: 'SV-P-ZH', tirage, bulba: { expansion: 'SV-P Promotional cards (ATCG)' } }]]), ...o });
const entZh = entree({ carteId: 'Pika-P', concordantes: [{ ...CONC, set: 'SV-P-ZH', nom: 'Pikachu' }] });
const pz = plan(entZh, monZh('zh-hans'));
verifier('générique (b) promo chinoise : set zh-hans, carte sans impression de ce tirage', [pz.ecrire.length, pz.ecrire[0]?.confirmation.cas, pz.refus.length], [1, 'promo-chinoise-jointure-virtuelle', 0]);
verifier('générique (b) : zh-hant aussi', plan(entZh, monZh('zh-hant')).ecrire[0]?.confirmation.cas, 'promo-chinoise-jointure-virtuelle');
refuse('générique (b) : set de tirage intl : refusé', plan(entZh, monZh('intl')), /carte-sans-impression-du-set/);
refuse('générique (b) : set sans tirage lisible : refusé', plan(entZh, monZh(undefined)), /carte-sans-impression-du-set/);
refuse('générique (b) : la carte a déjà une impression de ce tirage chinois (elle porterait donc une marque ; pas virtuelle) : refusé', plan(entZh, monZh('zh-hans', { cartes: new Map([['Pika-P', { ...SPEC, impressions: [{ numero: '9', expansion: 'X', tirage: 'zh-hans' }] }]]) })), /carte-sans-impression-du-set/);
refuse('une carte nommée d\'un set intl sans impression du set : reste refusée', plan(entZh, monZh('intl', { sets: new Map([['SV-P-ZH', { _id: 'SV-P-ZH', tirage: 'intl', bulba: { expansion: 'Promo' } }]]) })), /carte-sans-impression-du-set/);
refuse('générique (a) : énergie de base dont la carte ne porte pas ce numéro (cas des 3 sans-numero) : refusée', plan(entree(), monde({ cartes: new Map([[7, { ...CARTE, impressions: [{ numero: '7', expansion: 'Autre Set' }] }]]) })), /sans-numero/);
refuse('une énergie spéciale (« Double Colorless Energy ») sans impression du set : refusée (liste fermée)', plan(entree({ concordantes: [{ ...CONC, nom: 'Double Colorless Energy' }] }), monde({ produits: new Map([[11, { ...PRODUIT, name: 'Double Colorless Energy' }]]), cartes: new Map([[7, { ...CARTE, nomEn: 'Double Colorless Energy', impressions: [] }]]), cartesDuSet: () => [{ ...CARTE, nomEn: 'Double Colorless Energy' }] })), /carte-sans-impression-du-set/);
refuse('générique : les autres gardes tiennent (deux sources absentes)', plan(entree({ concordantes: [] }), ENERGIE_SANS_SET), /deux sources|concord/);
refuse('générique : les autres gardes tiennent (nom de la carte ≠ produit)', plan(entree(), monde({ cartes: new Map([[7, { ...CARTE, nomEn: 'Fire Energy', impressions: [] }]]), cartesDuSet: () => [{ ...CARTE, nomEn: 'Fire Energy' }] })), /nom de la carte/);
refuse('générique : les autres gardes tiennent (contradiction)', plan(entree({ refusees: [{ source: 'artofpkm', ref: 'r', raison: 'nom discordant (« Fire Energy » / « Water Energy »)' }] }), ENERGIE_SANS_SET), /contradi/);
refuse('générique : les autres gardes tiennent (deux lignes)', plan(entree(), monde({ cartes: ENERGIE_SANS_SET.cartes, lignes: new Map([[11, [LIGNE, { ...LIGNE, _id: 'x', carteId: 8 }]]]) })), /lignes/);
refuse('générique : les autres gardes tiennent (preuve non faible)', plan(entree(), monde({ cartes: ENERGIE_SANS_SET.cartes, lignes: new Map([[11, [{ ...LIGNE, preuve: 'set+numero' }]]]) })), /preuve/);
// l'écriture reteste la ligne
const appelsF = []; 
(async () => { await P.ecrireConfirmations({ collection: () => ({ updateOne: async (f) => { appelsF.push(f); return { modifiedCount: 1 }; } }) }, p0.ecrire);
verifier('écriture : le filtre reteste carteId et preuve de la ligne lue', appelsF[0], { _id: '7|11', carteId: 7, preuve: 'set+nom', confirmation: { $exists: false } });
})();
// ── déjà confirmée
const dejaC = P.planifier({ entrees: [entree()], lecture: monde(), le: LE }).ecrire[0].confirmation;
const lecDeja = monde({ lignes: new Map([[11, [{ ...LIGNE, confirmation: dejaC }]]]) });
verifier('déjà confirmée (identique) : rien à poser, jamais réécrite', (() => { const p = plan(entree(), lecDeja); return [p.ecrire.length, p.deja.length, p.refus.length]; })(), [0, 1, 0]);
verifier('déjà confirmée mais qui ne concorde plus : REFUSÉE (on n\'écrase jamais une valeur)', (() => { const p = plan(entree(), monde({ lignes: new Map([[11, [{ ...LIGNE, confirmation: { ...dejaC, valeurs: { ...dejaC.valeurs, numero: '999' } } }]]]) })); return [p.ecrire.length, p.refus.length, /écras|déjà/.test(raison(p))]; })(), [0, 1, true]);

// ── l'attendu
verifier('--attendu absent : arrêt', P.verifierAttendu(p0, undefined).ok, false);
verifier('--attendu différent du plan : arrêt', P.verifierAttendu(p0, 2).ok, false);
verifier('--attendu égal au plan', P.verifierAttendu(p0, 1).ok, true);

// ── l'écriture : additive, un seul champ, jamais sur une ligne déjà confirmée
(async () => {
    const appels = [];
    const db = { collection: nom => ({ updateOne: async (f, u, o) => { appels.push({ nom, f, u, o }); return { modifiedCount: 1, matchedCount: 1 }; } }) };
    const r = await P.ecrireConfirmations(db, p0.ecrire);
    verifier('écriture : un updateOne par ligne, sur cartes_produits, par _id ET seulement si aucune confirmation', [appels.length, appels[0].nom, appels[0].f], [1, 'cartes_produits', { _id: '7|11', carteId: 7, preuve: 'set+nom', confirmation: { $exists: false } }]);
    verifier('écriture : un $set de `confirmation` SEUL (aucun autre champ, aucun upsert)', [Object.keys(appels[0].u), Object.keys(appels[0].u.$set), appels[0].o?.upsert === true], [['$set'], ['confirmation'], false]);
    verifier('écriture : compte rendu', r, { posees: 1 });

    // relecture : les autres champs ne bougent pas
    const avant = [{ ...LIGNE }];
    const apresBon = [{ ...LIGNE, confirmation: p0.ecrire[0].confirmation }];
    const dbRelu = lignes => ({ collection: () => ({ find: () => ({ toArray: async () => lignes }) }) });
    verifier('relecture : la confirmation est là et rien d\'autre n\'a bougé', (await P.relire(dbRelu(apresBon), p0.ecrire, avant)).ok, true);
    verifier('relecture : un autre champ a bougé (preuve) : KO', (await P.relire(dbRelu([{ ...apresBon[0], preuve: 'set+numero' }]), p0.ecrire, avant)).ok, false);
    verifier('relecture : la confirmation manque : KO', (await P.relire(dbRelu(avant), p0.ecrire, avant)).ok, false);

    // executer : simulation sans écriture, écriture sous garde
    const faux = (ecritures) => async () => ({
        cartes: { db: { collection: n => collFaux(n, ecritures) } }, prod: { db: { collection: n => collFaux(n, ecritures) } }, fermer: async () => {} });
    const collFaux = (nom, ecritures) => {
        const data = { cartes_produits: [LIGNE], catalogue_produits: [{ idProduct: 11, name: 'Water Energy', idExpansion: 1547 }], numeros_cartes: [{ idProduct: 11, slugSet: 'EX-Emerald', numero: '103' }], cartes: [CARTE, AUTRE], sets: [{ _id: 'EX-Emerald', bulba: { expansion: 'EX Emerald' } }] }[nom] || [];
        return { collectionName: nom, find: (f, o) => ({ toArray: async () => data.filter(d => !f || !f._id && !f.idProduct && !f.sets || (f.idProduct?.$in || []).includes(d.idProduct) || (f._id?.$in || []).includes(d._id) || (f.sets && (d.sets || []).includes(f.sets))) }),
            countDocuments: async () => data.length, findOne: async () => data[0] || null,
            updateOne: async (...a) => { ecritures.push([nom, ...a]); return { modifiedCount: 1, matchedCount: 1 }; } };
    };
    const sortie = []; const log = (...a) => sortie.push(a.join(' ')); const err = (...a) => sortie.push('ERR ' + a.join(' '));
    const liste = JSON.stringify([entree()]);
    const lireListe = () => JSON.parse(liste);
    let ecr = [];
    const c1 = await P.executer({ argv: ['--liste=x.json', '--simuler'], ouvrirLecture: faux(ecr), ouvrirEcriture: async () => { throw new Error('la simulation ne doit pas ouvrir l\'écriture'); }, lireListe, log, err, garde: () => { throw new Error('garde appelée en simulation'); } });
    verifier('simulation : code 0, aucune écriture, plan annoncé', [c1, ecr.length, sortie.some(l => /1 confirmation/.test(l))], [0, 0, true]);
    ecr = [];
    const c2 = await P.executer({ argv: ['--liste=x.json', '--ecrire', '--attendu=1'], ouvrirLecture: faux(ecr), ouvrirEcriture: faux(ecr), lireListe, log, err, garde: () => { throw new Error('--ecrire refusé hors de lot-additif.js'); } }).catch(e => e.message);
    verifier('--ecrire hors lot-additif : refusé AVANT toute connexion, rien d\'écrit', [c2, ecr.length], ['--ecrire refusé hors de lot-additif.js', 0]);
    ecr = [];
    const c3 = await P.executer({ argv: ['--liste=x.json', '--ecrire', '--attendu=2'], ouvrirLecture: faux(ecr), ouvrirEcriture: faux(ecr), lireListe, log, err, garde: () => {} });
    verifier('--ecrire avec un --attendu faux : arrêt (code 1), rien d\'écrit', [c3, ecr.length], [1, 0]);
    ecr = [];
    const c4 = await P.executer({ argv: ['--liste=x.json', '--ecrire'], ouvrirLecture: faux(ecr), ouvrirEcriture: faux(ecr), lireListe, log, err, garde: () => {} });
    verifier('--ecrire sans --attendu : arrêt, rien d\'écrit', [c4, ecr.length], [1, 0]);
    const c5 = await P.executer({ argv: ['--liste=x.json'], ouvrirLecture: faux([]), ouvrirEcriture: faux([]), lireListe, log, err, garde: () => {} });
    verifier('ni --simuler ni --ecrire : usage, code 2', c5, 2);
    const c6 = await P.executer({ argv: ['--liste=x.json', '--simuler', '--hasard'], ouvrirLecture: faux([]), ouvrirEcriture: faux([]), lireListe, log, err, garde: () => {} });
    verifier('argument inconnu : refusé avant toute connexion, code 2', c6, 2);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ banc', e.stack); process.exit(1); });
