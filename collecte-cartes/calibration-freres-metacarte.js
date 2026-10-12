// ============================================================
// LA CALIBRATION DE LA CLÉ « FRÈRES DE MÉTACARTE » — UNE définition, pour le rapport ET pour la garde d'écriture (lot M2, §21 bis)
// ============================================================
// Vérité connue = les produits DÉJÀ joints par le numéro (cartes_produits : `set+numero` ou `setlist+numero`, UNE carte à page), dans un set INTL. La clé est
// rejouée sur chacun comme s'il n'était pas joint : ses frères (même idMetacard, même idExpansion) sont les AUTRES produits. La clé et la population de
// calibration sont les mêmes (leçon SEA-2) : c'est la fonction de production `designerParFreres`, appelée telle quelle.
// Trois épreuves, chacune avec ses cas ATTEINTS (la clé a dû CHOISIR) à côté des justes / faux / silences :
//   A  vérité présente : la clé doit rendre la MÊME carte, ou se taire ;
//   B  vraie carte RETIRÉE des frères ET du set (§67, sur la population ENTIÈRE, pas sur les désignations justes) : elle ne doit désigner personne ;
//   D  LE DANGER, deux populations isolées :
//      D-nom     les frères s'accordent sur une carte DONT LE NOM EST PORTÉ PAR UNE AUTRE CARTE DU SET : la clé doit se taire (nom non unique) ;
//      D-frères  les frères (>= 2 joints) se partagent entre DEUX cartes ou plus : la clé doit se taire.
//     Dans les deux, TOUTE désignation est un défaut (même juste : la clé accepterait un cas que sa propre règle écrit comme dangereux).
// 🔴 §41 : un mauvais export rend « tout silence » sans erreur. L'appariement export <-> lignes est vérifié par lecture-sure.apparier (LÈVE à 0), et le
// dénominateur s'imprime. 🔴 §67 : une ligne de vérité dont la carte est CONTREDITE par les attaques du produit n'est pas une vérité : écartée et COMPTÉE.
const J = require('./jointure');
const { apparier } = require('./lecture-sure');
const { temoinAttaques } = require('./cle-setlist-metacarte');
const K = require('./cle-freres-metacarte');

const PREUVES_VERITE = ['set+numero', 'setlist+numero'];

/**
 * LES MINIMUMS DE CAS ATTEINTS, et pourquoi (imprimés par la garde ; ils ne se baissent pas pour faire passer un lot, §23). Avec 0 faux sur n cas où la clé a dû
 * choisir, la borne haute à 95 % du taux de faux est 3/n (règle de trois). A (les désignations réelles, qui deviennent des fiches) : 300 cas -> borne 1 %.
 * D-nom et D-frères : la barre écrite d'avance était 100 (borne 3 %, comme SEA-2). MESURÉ le 2026-10-13 sur l'export du 2026-10-09 : 89 et 12 cas — la
 * population n'existe pas à 100. Ces deux gardes sont des REFUS PAR CONSTRUCTION (nom non unique dans le set ; frères sur plusieurs cartes), pas une décision
 * statistique : la règle de trois n'a pas de sens pour un code qui refuse sans seuil, et ce que le minimum doit prouver est que la garde a SERVI sur des cas
 * réels (population non vide, §41). Plancher posé à 10 pour les deux — décision à confirmer par le coordinateur, écrite ici et dans le rapport (§23 : un
 * minimum ne se baisse pas en silence). B n'a aucun minimum : sa population atteinte est vide par construction (retirer la vraie carte retire aussi ses
 * frères : 0 atteint sur 23 249) ; il reste dans la décision parce qu'UN seul faux y bloquerait l'écriture, et le banc fabrique le monde où il en compte.
 */
const MINIMUMS = Object.freeze({ A: 300, D_NOM: 10, D_FRERES: 10 });

const vide = () => ({ cas: 0, atteints: 0, justes: 0, fauxCarte: 0, silences: 0, faux: [] });
function compter(acc, { atteint, etat, detail }) {
    acc.cas++; if (atteint) acc.atteints++;
    if (etat === 'juste') acc.justes++; else if (etat === 'fauxCarte') { acc.fauxCarte++; if (acc.faux.length < 15) acc.faux.push(detail); } else acc.silences++;
}

/**
 * @param {object} o
 * @param {object[]} o.lignes   cartes_produits (idProduct, carteId, slugSet, numeroFiche, preuve)
 * @param {object[]} o.cartes   cartes (_id, nomEn, niveau, attaques, sets)
 * @param {Map<number,{name:string, idMetacard:number|null, idExpansion:number|null}>} o.export  l'export Cardmarket (chargerExport)
 * @param {object[]} o.sets     documents `sets` (_id, code, tirage, region)
 * @param {Array<{code:string, slugSet:string}>} [o.ecrits]  les sets qui ÉCRIRAIENT (leurs chiffres sont imprimés à part)
 */
function calibrer({ lignes, cartes, export: exp, sets, ecrits = [], log = () => { } }) {
    if (!lignes.length) throw new Error('cartes_produits est vide : la calibration ne peut pas se faire');
    const eligibles = lignes.filter(l => l.carteId > 0 && PREUVES_VERITE.includes(l.preuve));
    const avecMeta = [...exp].filter(([, v]) => v.idMetacard != null && v.idExpansion != null).map(([id]) => id);
    // §41 : l'appariement export <-> base, LEVÉ à 0
    const a1 = apparier(eligibles.map(l => l.idProduct), [...exp.keys()], { gauche: 'lignes de jointure par le numéro', droite: 'produits de l\'export', cle: 'idProduct' });
    const a2 = apparier(eligibles.map(l => l.idProduct), avecMeta, { gauche: 'lignes de jointure par le numéro', droite: 'produits de l\'export PORTANT idMetacard et idExpansion', cle: 'idProduct' });
    const metaDe = new Map([...exp].map(([id, v]) => [id, { idMetacard: v.idMetacard ?? null, idExpansion: v.idExpansion ?? null }]));
    const freres = K.indexerFreres(lignes, metaDe);
    const intl = new Set(sets.filter(s => (s.tirage ?? s.region) === 'intl').map(s => s._id));
    const cartesParSet = new Map();
    for (const c of cartes) for (const s of c.sets || []) if (intl.has(s)) (cartesParSet.get(s) || cartesParSet.set(s, []).get(s)).push(c);
    const carteParId = new Map(cartes.map(c => [c._id, c]));
    const produit = id => { const v = exp.get(id); return v ? { idProduct: id, name: v.name, ...J.decomposerNomCardmarket(v.name), idMetacard: v.idMetacard ?? null, idExpansion: v.idExpansion ?? null } : null; };

    // la population de vérité : un produit, UNE carte à page, dans UN set intl
    const parProduit = new Map();
    for (const l of eligibles) (parProduit.get(l.idProduct) || parProduit.set(l.idProduct, []).get(l.idProduct)).push(l);
    const verites = []; let hors = 0, ambigues = 0;
    for (const [id, ls] of parProduit) {
        const cs = new Set(ls.map(l => l.carteId)), ss = new Set(ls.map(l => l.slugSet));
        if (cs.size !== 1 || ss.size !== 1) { ambigues++; continue; }
        if (!intl.has(ls[0].slugSet)) { hors++; continue; }
        verites.push({ id, carteId: ls[0].carteId, slugSet: ls[0].slugSet });
    }
    const retrouvees = verites.filter(v => exp.has(v.id)).length;
    log(`   DÉNOMINATEUR : export ${exp.size} produits, ${avecMeta.length} avec métacarte et expansion · ${eligibles.length} lignes par le numéro, ${parProduit.size} produits (${hors} hors set intl, ${ambigues} à plusieurs cartes ou plusieurs sets, écartés) · vérité intl ${verites.length}, retrouvée dans l'export ${retrouvees} · appariement ${a1.trouvees.length}/${new Set(eligibles.map(l => l.idProduct)).size} (${(a1.taux * 100).toFixed(1)} %), avec métacarte ${a2.trouvees.length} (${(a2.taux * 100).toFixed(1)} %)`);
    if (!verites.length) throw new Error(`🔴 CALIBRATION VIDE : 0 produit de vérité dans un set intl sur ${parProduit.size} produits joints par le numéro (${hors} hors set intl) — un zéro sur une population non vide est un filtre faux (sets.tirage ? mauvais export ?), pas un résultat.`);

    const res = { denominateurs: { eligibles: eligibles.length, verites: verites.length, retrouvees, horsIntl: hors, ambigues }, veriteContredite: { total: 0, exemples: [] },
        total: { A: vide(), B: vide() }, danger: { nom: vide(), freres: vide() }, parSet: {}, minimums: MINIMUMS };
    const ecritsPar = new Map(ecrits.map(e => [e.slugSet, e.code]));
    for (const e of ecrits) res.parSet[e.code] = { A: vide(), B: vide() };
    const prepares = new Map();
    const setDe = slug => prepares.get(slug) || prepares.set(slug, K.preparerSet(cartesParSet.get(slug) || [], { slugSet: slug })).get(slug);
    for (const v of verites) {
        const p = produit(v.id); if (!p) continue;
        const vraie = carteParId.get(v.carteId);
        // §67 : la vérité contredite par les attaques du produit n'est pas une vérité
        if (vraie && temoinAttaques(vraie, p) === 'contredit') { res.veriteContredite.total++; if (res.veriteContredite.exemples.length < 10) res.veriteContredite.exemples.push(`${v.slugSet} ${p.name} -> carte ${v.carteId}`); continue; }
        const nom = `${v.slugSet} ${p.name} (${v.id})`;
        const set = setDe(v.slugSet);
        const rA = K.designerParFreres({ freres, set }, p);
        const etatA = !rA.carte ? 'silence' : rA.carte._id === v.carteId ? 'juste' : 'fauxCarte';
        const eA = { atteint: rA.atteint, etat: etatA, detail: `${nom} : carte ${rA.carte?._id} (vérité ${v.carteId})` };
        const rB = K.designerParFreres({ freres, set: K.preparerSet(cartesParSet.get(v.slugSet) || [], { slugSet: v.slugSet, sauf: v.carteId }) }, p, { sauf: v.carteId });
        const eB = { atteint: rB.atteint, etat: rB.carte ? 'fauxCarte' : 'silence', detail: `${nom} : ${rB.carte?._id} désignée, la vraie carte ${v.carteId} étant retirée` };
        compter(res.total.A, eA); compter(res.total.B, eB);
        const code = ecritsPar.get(v.slugSet);
        if (code) { compter(res.parSet[code].A, eA); compter(res.parSet[code].B, eB); }
        // D-nom : les frères s'accordent sur une carte, et le set en porte une autre au même nom
        if (rA.niveau >= 2 && rA.carteDesFreres != null) {
            const cf = set.parId.get(rA.carteDesFreres);
            if (cf && K.homonymesDe(set, cf).length) compter(res.danger.nom, { atteint: true, etat: rA.carte ? 'fauxCarte' : 'silence', detail: `${nom} : désignée ${rA.carte?._id} malgré un homonyme dans le set` });
        }
        // D-frères : >= 2 frères joints, sur >= 2 cartes
        const g = freres.get(`${p.idMetacard}|${p.idExpansion}`) || new Map();
        const jointes = [...g].filter(([id]) => id !== v.id), cartesFreres = new Set(jointes.flatMap(([, ls]) => ls.map(l => l.carteId)));
        if (jointes.length >= 2 && cartesFreres.size >= 2) compter(res.danger.freres, { atteint: rA.niveau >= 1, etat: rA.carte ? 'fauxCarte' : 'silence', detail: `${nom} : désignée ${rA.carte?._id} alors que les frères se partagent entre ${cartesFreres.size} cartes` });
    }
    if (res.total.A.cas === 0) throw new Error('🔴 CALIBRATION VIDE : 0 cas A évalué (toutes les vérités écartées par le témoin des attaques ?) — un zéro sur une population non vide est une clé fausse.');
    return res;
}

/** Le verdict de la garde : 0 faux partout ET assez de cas atteints. @returns {{ok: boolean, refus: string[]}} */
function verdict(cal, minimums = MINIMUMS) {
    const refus = [];
    for (const [nom, e] of [['A (vérité présente)', cal.total.A], ['B (vraie carte retirée)', cal.total.B], ['D-nom (homonyme dans le set)', cal.danger.nom], ['D-frères (frères partagés)', cal.danger.freres]])
        if (e.fauxCarte) refus.push(`${nom} : ${e.fauxCarte} faux de carte`);
    if (cal.total.A.atteints < minimums.A) refus.push(`A : ${cal.total.A.atteints} cas atteints < minimum ${minimums.A}`);
    if (cal.danger.nom.atteints < minimums.D_NOM) refus.push(`D-nom : ${cal.danger.nom.atteints} cas atteints < minimum ${minimums.D_NOM}`);
    if (cal.danger.freres.atteints < minimums.D_FRERES) refus.push(`D-frères : ${cal.danger.freres.atteints} cas atteints < minimum ${minimums.D_FRERES}`);
    return { ok: refus.length === 0, refus };
}

function imprimer(cal, log) {
    const ligne = (nom, e) => `   ${nom.padEnd(30)} cas ${String(e.cas).padStart(6)} · ATTEINTS ${String(e.atteints).padStart(6)} · justes ${String(e.justes).padStart(6)} · faux ${e.fauxCarte} · silences ${e.silences}`;
    log(ligne('A  vérité présente', cal.total.A)); log(ligne('B  vraie carte retirée', cal.total.B));
    log(ligne('D-nom  homonyme dans le set', cal.danger.nom)); log(ligne('D-frères  frères partagés', cal.danger.freres));
    log(`   vérités CONTREDITES par les attaques du produit, écartées de la population : ${cal.veriteContredite.total}${cal.veriteContredite.exemples.slice(0, 3).map(x => `\n      · ${x}`).join('')}`);
    for (const [code, s] of Object.entries(cal.parSet)) log(`      set ${code.padEnd(8)} A : ${s.A.cas} cas, ${s.A.atteints} atteints, ${s.A.justes} justes, faux ${s.A.fauxCarte} · B : ${s.B.atteints} atteints, faux ${s.B.fauxCarte}`);
    for (const e of ['total.A', 'total.B', 'danger.nom', 'danger.freres']) { const x = e.split('.').reduce((o, k) => o[k], cal); for (const f of x.faux.slice(0, 5)) log(`      🔴 ${e} : ${f}`); }
    log(`   minimums de cas atteints : A ${cal.minimums.A}, D-nom ${cal.minimums.D_NOM}, D-frères ${cal.minimums.D_FRERES} (B : aucun, 0 faux exigé)`);
}

module.exports = { calibrer, verdict, imprimer, chargerExport: require('./calibration-setlist-metacarte').chargerExport, MINIMUMS, PREUVES_VERITE };
