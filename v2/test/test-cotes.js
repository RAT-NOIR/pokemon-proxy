'use strict';
// COTES-VISUELS — les COTES de « Ma collection » (CONTRAT-API-V2.md §1.8) : { tendance, date } par fiche, lues dans `guide_prix` (base de l'API), via le lien fiche → produits EN MÉMOIRE.
// La règle : une fiche à UN produit a la cote de ce produit ; à PLUSIEURS, une cote seulement si TOUS ont la même tendance ET la même date de guide ; sinon null. Jamais une moyenne.
const H = require('./_harnais');
const { creerConstructeur } = require('../chargeur/version');
const { cotesDuSet, PRODUITS_MAX, DELAI_LECTURE_MS } = require('../collection/cotes');

const brut = id => ({ idProduct: id, vignette: { cle: `v/${id}.webp`, w: 2, h: 3 }, grande: null, visuel: 'du-set', mention: null, idMetacard: null, numero: null, rarete: null, total: null, variante: null, setNom: null, lien: null });
function version(fiches) {
    const b = creerConstructeur();
    const tous = new Set(fiches.flatMap(([, ids]) => ids));
    for (const id of tous) b.entree(brut(id));
    for (const [cle, ids, set = 'Set-A'] of fiches) b.lien(set, cle, ids);
    return b.finir();
}
// un faux guide_prix qui compte ses requêtes
function fauxGuide(lignes) {
    const appels = [];
    return { appels, col: nom => ({ find: (filtre, opts) => { appels.push([nom, JSON.stringify(filtre), JSON.stringify(opts || null)]); const ids = new Set(filtre.idProduct.$in); return { toArray: async () => lignes.filter(l => ids.has(l.idProduct)) }; } }) };
}
const g = (idProduct, trend, guideDu = '2026-10-01') => ({ idProduct, trend, guideDu });

(async () => {
    const V = version([['10|001', [1]], ['11|002', [2, 3]], ['12|003', [4, 5]], ['13|-', [6]], ['14|004', [7, 8]], ['15|005', [9]], ['16|006', [10]], ['17|007', [11, 12]], ['18|008', [13]], ['20|009', [14], 'Set-B']]);
    const guide = fauxGuide([g(1, 4.5), g(2, 2), g(3, 2), g(4, 3), g(5, 3.5), g(6, 0.99, new Date('2026-09-30T00:00:00Z')), g(7, 5, '2026-10-01'), g(8, 5, '2026-09-01'), g(9, 0), g(10, 'abc'), g(11, 7), /* 12 sans guide */ g(13, 1, '31/12/2026'), g(14, 9)]);
    const c = await cotesDuSet('Set-A', { version: () => V, col: guide.col });

    H.v('une fiche à UN produit : la tendance et la date du guide', c['10|001'], { tendance: 4.5, date: '2026-10-01' });
    H.v('plusieurs produits, MÊME tendance et MÊME date : cette cote', c['11|002'], { tendance: 2, date: '2026-10-01' });
    H.v('plusieurs produits, tendances DIFFÉRENTES (3 et 3,5) : null — jamais une moyenne, un minimum ni un maximum', c['12|003'], null);
    H.v('plusieurs produits, même tendance, DATES différentes : null', c['14|004'], null);
    H.v('une date de guide en Date : rendue en AAAA-MM-JJ ; clé sans numéro « 13|- » exacte', c['13|-'], { tendance: 0.99, date: '2026-09-30' });
    H.v('tendance nulle, non numérique : null (un prix nul n\'est pas une cote)', [c['15|005'], c['16|006']], [null, null]);
    H.v('plusieurs produits dont l\'un SANS guide : null (on ne sait pas)', c['17|007'], null);
    H.v('une date illisible : null (un prix non daté n\'est pas servi)', c['18|008'], null);
    H.v('toutes les fiches du set sont des clés (null compris), aucune d\'un autre set', Object.keys(c).sort(), ['10|001', '11|002', '12|003', '13|-', '14|004', '15|005', '16|006', '17|007', '18|008']);
    H.v('UNE seule requête guide_prix, bornée aux produits du set (13 ids, pas ceux de Set-B)', [guide.appels.length, guide.appels[0][0], JSON.parse(guide.appels[0][1]).idProduct.$in.length], [1, 'guide_prix', 13]);
    H.vrai('   la projection de la requête ne ramène que idProduct, trend, guideDu', /"projection":\{[^}]*"trend":1[^}]*\}/.test(guide.appels[0][2]));

    // les cas limites
    H.v('aucune version chargée : {} (l\'état « sans visuel », jamais une erreur)', await cotesDuSet('Set-A', { version: () => null, col: guide.col }), {});
    H.v('set sans lien : {}', await cotesDuSet('Set-Z', { version: () => V, col: guide.col }), {});
    H.v('slug non chaîne : {}', await cotesDuSet(null, { version: () => V, col: guide.col }), {});
    const vide = fauxGuide([]);
    const sansGuide = await cotesDuSet('Set-B', { version: () => V, col: vide.col });
    H.v('aucun produit au guide : toutes les fiches à null', sansGuide, { '20|009': null });
    let leve = null; try { await cotesDuSet('Set-A', { version: () => V, col: () => ({ find: () => ({ toArray: async () => { throw new Error('panne'); } }) }) }); } catch (e) { leve = e.message; }
    H.v('une panne du guide REMONTE (la route décide de la dégrader en {}, ce module ne ment pas)', leve, 'panne');
    // ── la BORNE DURE (revue I7) : 5 000 produits par appel au plus, cotes PARTIELLES dites, maxTimeMS, projection minimale
    H.v('PRODUITS_MAX = 5 000 et un délai de lecture de 2 s', [PRODUITS_MAX, DELAI_LECTURE_MS], [5000, 2000]);
    H.vrai('   la requête porte maxTimeMS et la projection minimale (3 champs, pas de _id)', (() => { const o = JSON.parse(guide.appels[0][2]); return o.maxTimeMS === 2000 && Object.keys(o.projection).sort().join() === '_id,guideDu,idProduct,trend'; })());
    const grosse = creerConstructeur();
    for (let id = 1; id <= 7000; id++) grosse.entree(brut(id));
    for (let k = 0; k < 7000; k++) grosse.lien('Gros-Set', `${k + 1}|${String(k + 1).padStart(4, '0')}`, [k + 1]);
    const GV = grosse.finir();
    const journaux = []; const G = fauxGuide(Array.from({ length: 7000 }, (_, k) => g(k + 1, 1 + k)));
    const cg = await cotesDuSet('Gros-Set', { version: () => GV, col: G.col, journal: m => journaux.push(m) });
    H.v('un set de 7 000 produits : cotes PARTIELLES (les 5 000 premières fiches), le reste absent (= null pour le site), UNE requête de 5 000 ids', [Object.keys(cg).length, cg['5000|5000'], cg['5001|5001'], G.appels.length, JSON.parse(G.appels[0][1]).idProduct.$in.length], [5000, { tendance: 5000, date: '2026-10-01' }, undefined, 1, 5000]);
    H.vrai('   et la troncature est JOURNALISÉE (« cotes PARTIELLES »)', journaux.length === 1 && /PARTIELLES.*5000 fiches sur 7000/.test(journaux[0]));
    const pile = creerConstructeur(); for (let id = 1; id <= 5000; id++) pile.entree(brut(id)); for (let k = 0; k < 5000; k++) pile.lien('Pile', `${k + 1}|x`, [k + 1]);
    const j2 = []; const cp = await cotesDuSet('Pile', { version: () => pile.finir(), col: fauxGuide(Array.from({ length: 5000 }, (_, k) => g(k + 1, 2))).col, journal: m => j2.push(m) });
    H.v('   un set de 5 000 produits pile : complet, rien de tronqué', [Object.keys(cp).length, j2.length], [5000, 0]);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
