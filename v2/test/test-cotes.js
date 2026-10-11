'use strict';
// COTES-VISUELS — les COTES de « Ma collection » (CONTRAT-API-V2.md §1.8) : { tendance, date } par fiche, lues dans `guide_prix` (base de l'API), via le lien fiche → produits EN MÉMOIRE.
// La règle : une fiche à UN produit a la cote de ce produit ; à PLUSIEURS, une cote seulement si TOUS ont la même tendance ET la même date de guide ; sinon null. Jamais une moyenne.
const H = require('./_harnais');
const { creerConstructeur } = require('../chargeur/version');
const { cotesDuSet } = require('../collection/cotes');

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
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
