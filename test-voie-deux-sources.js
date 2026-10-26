// BANC — la 5e voie de collecte-cartes/fiches-prouvees.js (« deux-sources ») et son planificateur collecte-cartes/voie-deux-sources.js (V5, 2026-10-26).
//   node test-voie-deux-sources.js
// Aucune base, aucune requête : des faux. La voie remplace la Setlist par UNE seconde source indépendante (Cardmarket + au moins une source de SOURCES_ADMISES) ; la Setlist ne sert JAMAIS.
const { prouver, VOIES } = require('./collecte-cartes/fiches-prouvees');
const { decomposerNomCardmarket } = require('./collecte-cartes/jointure');
const V = require('./collecte-cartes/voie-deux-sources');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const SET = 'Scarlet-Violet-Simplified-Chinese-Promos';
const EXPANSION = 'Scarlet & Violet Promotional cards (ATCG)';
const carte = (id, nomEn, attaques, impressions = [], extra = {}) => ({ _id: id, nomEn, niveau: null, attaques: attaques.map(nom => ({ nom })), impressions, sets: [SET], liens: { idProduct: [1], idMetacards: [500] }, ...extra });
const produit = (idProduct, name, numero, idMetacard = 500, idExpansion = 9) => { const d = decomposerNomCardmarket(name); return { idProduct, idExpansion, idMetacard, name, nom: d.nom, attaques: d.attaques, niveau: d.niveau, numero, slug: `s-${idProduct}`, slugSet: SET }; };
const conc = (source, numero = '214', nom = 'Gengar ex', set = SET) => ({ source, ref: `${source}/x`, set, numero, nom, par: 'nom' });
const gengar = carte(10, 'Gengar ex', ['Shadowy Claw']);
const pGengar = produit(20, 'Gengar ex [Shadowy Claw]', '214');
const entree = (extra = {}) => ({ idProduct: 20, carteId: 10, voie: 'deux-sources', tirage: 'zh-hans', slugSet: SET, secondeSource: { concordantes: [conc('pikaqian')], refusees: [] }, ...extra });
const ctx = (cartes, extra = {}) => ({ cartesDuSet: cartes, cartesPourCle: cartes, etatSetlist: null, ...extra });
const p = (e, pr, c, cartes, extra) => prouver({ entree: e, produit: pr, carte: c, ...ctx(cartes, extra) });

console.log('── la voie');
verifier('les voies : la 5e est « deux-sources »', VOIES, ['impression-numero', 'impression-equivalente', 'setlist', 'impression-du-tirage', 'deux-sources']);
const bon = p(entree(), pGengar, gengar, [gengar]);
verifier('deux sources (Cardmarket + pikaqian) + nom/attaques + métacarte + témoin : prouvé, les deux sources sont NOMMÉES dans les témoins', [bon.ok, bon.temoins.some(t => /cardmarket/i.test(t) && /pikaqian/.test(t))], [true, true]);
verifier('la Setlist n\'est JAMAIS consultée : aucune Setlist lue ne refuse', p(entree(), pGengar, gengar, [gengar], { etatSetlist: { pages: [] } }).ok, true);
verifier('la Setlist n\'est JAMAIS une preuve : une Setlist qui « confirme » ne sauve pas l\'absence de seconde source', p(entree({ secondeSource: { concordantes: [], refusees: [] } }), pGengar, gengar, [gengar], { etatSetlist: { pages: [{ titre: 'Gengar ex (SVP Promo 214)', pageid: 10, etat: 'ok' }] } }).ok, false);
verifier('une Setlist qui nomme AUTRE chose au même numéro (numéros des promos anglais) ne contredit rien : la voie ne la lit pas', p(entree(), pGengar, gengar, [gengar], { etatSetlist: { pages: [{ titre: 'Cleffa (SVP Promo 214)', pageid: 77, etat: 'ok' }] } }).ok, true);
verifier('sans seconde source → refus nommé', (() => { const r = p(entree({ secondeSource: { concordantes: [], refusees: [] } }), pGengar, gengar, [gengar]); return [r.ok, /seconde source|concordante/.test(r.refus.join())]; })(), [false, true]);
verifier('sans bloc secondeSource du tout → refus (un doute est un refus)', p(entree({ secondeSource: undefined }), pGengar, gengar, [gengar]).ok, false);
verifier('Bulbapedia ne compte jamais : une concordante « bulbapedia » → refus', p(entree({ secondeSource: { concordantes: [conc('bulbapedia')], refusees: [] } }), pGengar, gengar, [gengar]).ok, false);
verifier('une source hors de la liste admise (ppr, non calibrée) → refus', p(entree({ secondeSource: { concordantes: [conc('ppr')], refusees: [] } }), pGengar, gengar, [gengar]).ok, false);
verifier('une concordante à un AUTRE numéro → refus', p(entree({ secondeSource: { concordantes: [conc('pikaqian', '215')], refusees: [] } }), pGengar, gengar, [gengar]).ok, false);
verifier('une concordante d\'un AUTRE set → refus', p(entree({ secondeSource: { concordantes: [conc('pikaqian', '214', 'Gengar ex', 'Autre-Set')], refusees: [] } }), pGengar, gengar, [gengar]).ok, false);
verifier('une concordante au nom discordant → refus', p(entree({ secondeSource: { concordantes: [conc('pikaqian', '214', 'Pikachu')], refusees: [] } }), pGengar, gengar, [gengar]).ok, false);
const lisible = { source: 'artofpkm', ref: 'images 1', raison: 'nom discordant (« Noctowl » / « Ditto »)' };
const illisible = { source: 'tpc-asie', ref: 'tpc 1', raison: 'nom discordant (« ゲンガーex » / « Gengar ex »)' };
verifier('CONTRADICTION : un relevé LISIBLE d\'une autre source dit un autre nom au même (set, numéro) → refus, même si pikaqian concorde', (() => { const r = p(entree({ secondeSource: { concordantes: [conc('pikaqian')], refusees: [lisible] } }), pGengar, gengar, [gengar]); return [r.ok, /contradi/i.test(r.refus.join())]; })(), [false, true]);
verifier('un relevé au nom ILLISIBLE (japonais) n\'est pas une contradiction', p(entree({ secondeSource: { concordantes: [conc('pikaqian')], refusees: [illisible] } }), pGengar, gengar, [gengar]).ok, true);
verifier('une refusée « numéro différent » / « set différent » n\'est pas une contradiction de nom', p(entree({ secondeSource: { concordantes: [conc('pikaqian')], refusees: [{ source: 'artofpkm', raison: 'numéro différent (5 / 214)' }, { source: 'tcgdex', raison: 'set différent (x)' }] } }), pGengar, gengar, [gengar]).ok, true);

console.log('── les gardes de production restent entières');
verifier('la métacarte du produit n\'est pas celle de la carte → refus', p(entree(), produit(20, 'Gengar ex [Shadowy Claw]', '214', 999), gengar, [gengar]).ok, false);
verifier('un nom qui n\'est pas celui de la carte → refus', p(entree(), produit(20, 'Haunter [Shadowy Claw]', '214'), gengar, [gengar]).ok, false);
verifier('d\'autres attaques → refus', p(entree(), produit(20, 'Gengar ex [Autre]', '214'), gengar, [gengar]).ok, false);
verifier('un produit SANS numéro → refus (la seconde source ne confirme rien sans numéro)', p(entree(), produit(20, 'Gengar ex [Shadowy Claw]', null), gengar, [gengar]).ok, false);
verifier('une carte qui n\'est pas dans le set → refus', p(entree(), pGengar, { ...gengar, sets: ['Autre-Set'] }, [{ ...gengar, sets: ['Autre-Set'] }]).ok, false);
verifier('la carte désignée est une FICHE SIMPLE → refus (elle a été posée pour un autre produit)', (() => { const fsimple = carte(-5, 'Gengar ex', ['Shadowy Claw'], [{ tirage: 'zh-hans', expansion: EXPANSION, numero: '214', source: 'cardmarket' }], { ficheSimple: { le: 'x' } }); return p(entree({ carteId: -5 }), pGengar, fsimple, [fsimple]).ok; })(), false);

console.log('── A3 : plusieurs candidates, départagées par le NUMÉRO de la fiche simple');
const fiche = (id, numero, extra = {}) => carte(id, 'Gengar ex', ['Shadowy Claw'], numero == null ? [] : [{ tirage: 'zh-hans', expansion: EXPANSION, numero, source: 'cardmarket' }], { ficheSimple: { le: 'x' }, liens: { idProduct: [-id], idMetacards: [500] }, ...extra });
verifier('une fiche simple qui porte le numéro d\'un AUTRE produit n\'est pas candidate → prouvé', p(entree(), pGengar, gengar, [gengar, fiche(-1, '089'), fiche(-2, '090')]).ok, true);
verifier('une fiche simple au MÊME numéro reste candidate → deux candidates, refus', (() => { const r = p(entree(), pGengar, gengar, [gengar, fiche(-1, '214')]); return [r.ok, /candidate/.test(r.refus.join())]; })(), [false, true]);
verifier('une fiche simple dont on ne connaît aucun numéro reste candidate (un doute est un refus)', p(entree(), pGengar, gengar, [gengar, fiche(-1, null)]).ok, false);
verifier('une VRAIE carte homonyme aux mêmes attaques reste candidate, quel que soit son numéro → refus', p(entree(), pGengar, gengar, [gengar, carte(11, 'Gengar ex', ['Shadowy Claw'], [{ tirage: 'intl', expansion: 'X', numero: '1' }])]).ok, false);
verifier('le numéro d\'une fiche simple se lit aussi par ses LIGNES (numerosDe injecté)', (() => { const f = fiche(-1, null); return p(entree(), pGengar, gengar, [gengar, f], { numerosDe: c => new Set(c._id === -1 ? ['89'] : []) }).ok; })(), true);
verifier('« 089 » et « 89 » sont le même numéro, « 214a » n\'est pas « 214 »', [p(entree(), pGengar, gengar, [gengar, fiche(-1, '214a')]).ok, p(entree(), produit(20, 'Gengar ex [Shadowy Claw]', '089'), gengar, [gengar, fiche(-1, '89')], { secondeSource: undefined }).ok], [true, false]);

console.log('── le planificateur (ligne + impression numero-cardmarket)');
const set = { _id: SET, tirage: 'zh-hans', idExpansion: [9], bulba: { expansion: EXPANSION } };
const lecture = (cartes, extra = {}) => ({ cartes, sets: new Map([[SET, set]]), produits: new Map([[9, [pGengar]]]), NC: new Map([[20, { numero: '214' }]]), lignes: [], ...extra });
const E = { idProduct: 20, idExpansion: 9, slugSet: SET, secondeSource: { concordantes: [conc('pikaqian')], refusees: [] } };
const LE = new Date('2026-10-26T00:00:00Z');
const pl = V.planifierVoie({ entrees: [E], lecture: lecture([gengar]), le: LE });
verifier('une ligne prouvée : _id, preuve, route, numeroFiche = numéro Cardmarket, les deux sources nommées', pl.lignes.map(l => [l._id, l.carteId, l.preuve, l.route, l.numeroFiche, l.slugSet, l.tirage, l.confirmation.sources, /pikaqian/.test(l.detail) && /cardmarket/i.test(l.detail)]), [['10|20', 10, 'fiche-prouvee', V.ROUTE, '214', SET, 'zh-hans', ['cardmarket', 'pikaqian'], true]]);
verifier('l\'impression manquante au numéro Cardmarket est posée (source numero-cardmarket, tirage et expansion du set)', pl.impressions, [{ carteId: 10, imp: { tirage: 'zh-hans', expansion: EXPANSION, numero: '214', total: null, deck: null, rarete: null, source: 'numero-cardmarket' } }]);
verifier('aucun refus', pl.refus, []);
verifier('la carte déclare déjà ce numéro dans le set : la ligne se pose, AUCUNE impression', (() => { const c = carte(10, 'Gengar ex', ['Shadowy Claw'], [{ tirage: 'zh-hans', expansion: EXPANSION, numero: '214' }]); const r = V.planifierVoie({ entrees: [E], lecture: lecture([c]), le: LE }); return [r.lignes.length, r.impressions.length]; })(), [1, 0]);
verifier('A2 : la carte porte déjà un AUTRE numéro dans ce set → REFUS du produit entier (ni ligne ni impression)', (() => { const c = carte(10, 'Gengar ex', ['Shadowy Claw'], [{ tirage: 'zh-hans', expansion: EXPANSION, numero: '100' }]); const r = V.planifierVoie({ entrees: [E], lecture: lecture([c]), le: LE }); return [r.lignes.length, r.impressions.length, r.refus.length, /autre numéro/.test(r.refus.map(x => x.raison).join())]; })(), [0, 0, 1, true]);
verifier('une impression SANS numéro dans ce set → refus (fiche déjà ambiguë)', (() => { const c = carte(10, 'Gengar ex', ['Shadowy Claw'], [{ tirage: 'zh-hans', expansion: EXPANSION, numero: null }]); return V.planifierVoie({ entrees: [E], lecture: lecture([c]), le: LE }).lignes.length; })(), 0);
verifier('un produit qui a DÉJÀ une ligne → refus (on ne pose que des lignes absentes)', V.planifierVoie({ entrees: [E], lecture: lecture([gengar], { lignes: [{ _id: '99|20', carteId: 99, idProduct: 20, slugSet: SET }] }), le: LE }).refus.length, 1);
verifier('une vraie carte d\'un autre nom déclare déjà ce numéro dans le set → refus (doublon)', (() => { const autre = carte(12, 'Haunter', ['Lick'], [{ tirage: 'zh-hans', expansion: EXPANSION, numero: '214' }], { liens: { idProduct: [2], idMetacards: [501] } }); return V.planifierVoie({ entrees: [E], lecture: lecture([gengar, autre]), le: LE }).lignes.length; })(), 0);
verifier('un set sans UN nom d\'expansion → refus', V.planifierVoie({ entrees: [E], lecture: lecture([gengar], { sets: new Map([[SET, { ...set, bulba: {} }]]) }), le: LE }).lignes.length, 0);
verifier('un set absent de la base → refus', V.planifierVoie({ entrees: [E], lecture: lecture([gengar], { sets: new Map() }), le: LE }).lignes.length, 0);
verifier('un produit absent du catalogue de l\'expansion → refus', V.planifierVoie({ entrees: [{ ...E, idProduct: 404 }], lecture: lecture([gengar]), le: LE }).refus.length, 1);
verifier('un produit en matière spéciale → refus', (() => { const { PRODUITS_MATIERE_SPECIALE } = require('./collecte-cartes/matiere-speciale'); const id = Number(Object.keys(PRODUITS_MATIERE_SPECIALE)[0]); const pr = { ...pGengar, idProduct: id }; return V.planifierVoie({ entrees: [{ ...E, idProduct: id }], lecture: lecture([gengar], { produits: new Map([[9, [pr]]]), NC: new Map([[id, { numero: '214' }]]) }), le: LE }).lignes.length; })(), 0);
verifier('l\'expansion du produit n\'est pas celle du set → refus', V.planifierVoie({ entrees: [{ ...E, idExpansion: 77 }], lecture: lecture([gengar], { produits: new Map([[77, [{ ...pGengar, idExpansion: 77 }]]]) }), le: LE }).lignes.length, 0);
verifier('deux produits (V1, V2) au même numéro et à la même carte : deux lignes, UNE impression', (() => { const p2 = produit(21, 'Gengar ex [Shadowy Claw]', '214'); const r = V.planifierVoie({ entrees: [E, { ...E, idProduct: 21 }], lecture: lecture([gengar], { produits: new Map([[9, [pGengar, p2]]]), NC: new Map([[20, { numero: '214' }], [21, { numero: '214' }]]) }), le: LE }); return [r.lignes.length, r.impressions.length]; })(), [2, 1]);
verifier('A3 de bout en bout : les fiches simples d\'autres numéros ne bloquent pas, la bonne carte est désignée', (() => { const r = V.planifierVoie({ entrees: [E], lecture: lecture([gengar, fiche(-1, '089'), fiche(-2, '090')], { lignes: [{ _id: '-1|-1', carteId: -1, idProduct: -1, slugSet: SET, numeroFiche: '089' }, { _id: '-2|-2', carteId: -2, idProduct: -2, slugSet: SET, numeroFiche: '090' }] }), le: LE }); return [r.lignes.map(l => l.carteId), r.refus.length]; })(), [[10], 0]);
verifier('le plan JSON (format --plans de simuler-abc) : lignes, impressions, cartesSets vide', (() => { const j = V.planJson(pl, new Map([[20, 'SV-P/CS']])); return [j.outil, j.lignes.length, j.impressions.length, j.cartesSets, j.lignes[0].code]; })(), ['poser-fiches-voie-deux-sources', 1, 1, [], 'SV-P/CS']);
verifier('--attendu : le bon nombre passe, un autre ou l\'absence refuse', [V.verifierAttendu(pl, 1).ok, V.verifierAttendu(pl, 2).ok, V.verifierAttendu(pl, undefined).ok], [true, false, false]);
verifier('--attendu : un plan qui a des refus n\'écrit pas (le plan complet est celui qu\'on a simulé)', V.verifierAttendu({ lignes: pl.lignes, refus: [{ idProduct: 1, raison: 'x' }] }, 1).ok, false);
verifier('la preuve de l\'impression nomme le produit, le numéro, les sources et la liste', (() => { const m = V.preuvesImpressions(pl, 'liste-x.json'); return [...m.values()].map(t => [/idProduct 20/.test(t), /n°214/.test(t), /pikaqian/.test(t), /liste liste-x\.json$/.test(t)]); })(), [[true, true, true, true]]);

console.log('── l\'écriture (orchestration, avec des faux : ecrireFiches / ecrireLot sont ceux de la production, déjà bancs)');
(async () => {
    const appels = [];
    const faux = { ecrireFiches: async (db, lignes, metaDe) => { appels.push(['fiches', lignes.length, [...metaDe]]); return { lignes: lignes.length, cartes: 1 }; }, relire: async () => ({ ok: true, lignes: '1/1', cartes: '1/1', reperesBouges: [], manques: [] }), ecrireLot: async ({ R, nomListe }) => { appels.push(['impressions', [...R.aPoser.values()].flat().length, nomListe]); return 0; } };
    const sortie = []; const log = s => sortie.push(s), err = s => sortie.push('ERR ' + s);
    const c1 = await V.ecrire({ db: {}, plan: pl, attendu: 2, nomListe: 'l.json', metaDe: new Map([[20, 500]]), repereAvant: new Map(), dep: faux, log, err });
    verifier('mauvais --attendu : rien n\'est appelé, code 1', [c1, appels.length], [1, 0]);
    const c2 = await V.ecrire({ db: {}, plan: pl, attendu: 1, nomListe: 'l.json', metaDe: new Map([[20, 500]]), repereAvant: new Map(), dep: faux, log, err });
    verifier('bon --attendu : les LIGNES d\'abord, puis les impressions, code 0', [c2, appels.map(a => a[0]), appels[1][1], appels[1][2]], [0, ['fiches', 'impressions'], 1, 'l.json']);
    const appels2 = [];
    const casse = { ...faux, relire: async () => ({ ok: false, lignes: '0/1', cartes: '0/1', reperesBouges: [], manques: [] }), ecrireLot: async () => { appels2.push('imp'); return 0; } };
    const c3 = await V.ecrire({ db: {}, plan: pl, attendu: 1, nomListe: 'l.json', metaDe: new Map(), repereAvant: new Map(), dep: casse, log, err });
    verifier('une relecture des lignes qui échoue : code 1 et les impressions ne sont PAS posées', [c3, appels2.length], [1, 0]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
