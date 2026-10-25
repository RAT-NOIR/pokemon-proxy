'use strict';
// Banc de collecte-cartes/comblement.js et de comblement-nocturne.js : AUCUNE base, AUCUN réseau, des faux en mémoire (fournisseurs, clients, base, décideur), des images fabriquées pour la seule chaîne réelle.
// Chaque cas doit pouvoir ÉCHOUER : les gardes sont rejouées sur des états fabriqués (une garde jamais vue dire non n'est pas vérifiée).
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const CO = require('./collecte-cartes/comblement');
const CI = require('./collecte-cartes/concordance-image');

let ok = 0, ko = 0;
function v(nom, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? 'OK ' : 'KO '} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}
const vrai = (nom, cond) => v(nom, Boolean(cond), true);
async function leve(nom, f, motif) {
    let msg = null;
    try { await f(); } catch (e) { msg = e.message; }
    vrai(`${nom} : lève`, msg !== null && (!motif || motif.test(msg)));
}

// ── des fournisseurs de mémoire ──
const SRC = (code, langue = 'en', tampon = () => undefined) => ({ SOURCE: code, LANGUE: langue, tampon });
const def = (code, o = {}) => ({ CODE: code, SRC: SRC(code, o.langue, o.tampon), DOSSIER: path.join(os.tmpdir(), `faux-${code}`), hoteImages: o.hote ?? `img.${code}.example.com`,
    clientDe: o.clientDe ?? (() => { throw new Error(`clientDe(${code}) ne devait pas être appelé`); }), construirePlan: o.construirePlan ?? (async () => ({ unites: [], restes: [] })) });
const unite = (o) => ({ carteId: 1, slugSet: 'Set-A', numero: '024', produits: [100], url: 'https://x/1.jpg', numeroSource: '024/208', idSource: 'k1', groupe: 'g', decision: { action: 'ajouter', remplace: [] }, ...o });

(async () => {
    // ───────────── motifs fermés et trous nommés (R7) ─────────────
    const attendusMotifs = ['aucune-source', 'une-seule-source', 'discordance-image', 'tirage-different', 'illisible', 'sans-offre', 'sous-le-seuil', 'a-confirmer'];
    v('motifs fermés : la liste', CO.MOTIFS, attendusMotifs);
    for (const m of [...attendusMotifs, 'source-bloquee:tcs', 'source-bloquee:scx']) vrai(`motif « ${m} » admis`, CO.motifAdmis(m));
    for (const m of ['n-importe-quoi', '', null, undefined, 'source-bloquee:', 'source-bloquee:TCS', 'source-bloquee:a b', 'Aucune-source', 'a-confirmer ']) vrai(`motif ${JSON.stringify(m)} refusé`, !CO.motifAdmis(m));
    await leve('construireTrou : motif hors liste', () => CO.construireTrou({ idProduct: 1, motif: 'inconnu', sources: ['scx'], preuve: {}, le: new Date() }), /motif/);
    await leve('construireTrou : sans idProduct entier', () => CO.construireTrou({ idProduct: '12', motif: 'illisible', sources: ['scx'], preuve: {}, le: new Date() }), /idProduct/);
    await leve('construireTrou : sources absentes', () => CO.construireTrou({ idProduct: 1, motif: 'illisible', sources: null, preuve: {}, le: new Date() }), /sources/);
    await leve('construireTrou : date absente', () => CO.construireTrou({ idProduct: 1, motif: 'illisible', sources: ['scx'], preuve: {} }), /date/);
    const t1 = CO.construireTrou({ idProduct: 5, motif: 'une-seule-source', sources: ['scx', 'ppr'], preuve: { a: 1 }, le: new Date('2026-10-26T00:00:00Z') });
    v('construireTrou : forme', [t1.idProduct, t1.motif, t1.sources, t1.instrument], [5, 'une-seule-source', ['scx', 'ppr'], 'comblement-nocturne']);

    // ── ecrireTrous : une base fausse qui enregistre ; additif seulement (jamais de suppression) ; F2 : on LIT d'abord, on n'écrit que le nouveau ou le changé ; F4 : les résolus ──
    const ops = [];
    let existants = [];
    const fauxDb = { collection: (n) => ({ find: () => ({ toArray: async () => existants }), bulkWrite: async (o, opt) => { ops.push({ n, o, opt }); return { upsertedCount: o.length, modifiedCount: 0 }; } }) };
    const le = new Date('2026-10-26T00:00:00Z');
    const t6 = CO.construireTrou({ idProduct: 6, motif: 'sans-offre', sources: [], preuve: {}, le });
    let rap = await CO.ecrireTrous(fauxDb, [t1, t6]);
    v('ecrireTrous : collection trous_nommes', ops.map(o => o.n), ['trous_nommes']);
    const op0 = ops[0].o[0].updateOne;
    v('ecrireTrous : _id = idProduct, upsert, $set (resolu:false) et $setOnInsert(premierLe)', [op0.filter, op0.upsert, Object.keys(op0.update.$set).sort(), Object.keys(op0.update.$setOnInsert)], [{ _id: 5 }, true, ['idProduct', 'instrument', 'le', 'motif', 'preuve', 'resolu', 'sources'], ['premierLe']]);
    vrai('ecrireTrous : aucune suppression ni remplacement', ops[0].o.every(x => x.updateOne && !x.deleteOne && !x.replaceOne));
    v('ecrireTrous : rapport, tout est nouveau', rap, { nouveaux: 2, changes: 0, inchanges: 0, resolus: 0, rouverts: 0 });
    ops.length = 0;
    existants = [{ _id: 5, motif: 'une-seule-source', sources: ['ppr', 'scx'] }, { _id: 6, motif: 'aucune-source', sources: [] }, { _id: 7, motif: 'illisible', sources: ['scx'] }];
    rap = await CO.ecrireTrous(fauxDb, [t1, t6]);
    v('F2 : motif ET sources (triées) inchangés = pas réécrit ; motif changé = réécrit', [rap.inchanges, rap.changes, rap.nouveaux, ops[0].o.map(x => x.updateOne.filter._id)], [1, 1, 0, [6]]);
    ops.length = 0;
    existants = [{ _id: 5, motif: 'une-seule-source', sources: ['ppr', 'scx'] }, { _id: 6, motif: 'sans-offre', sources: [] }];
    rap = await CO.ecrireTrous(fauxDb, [t1, t6]);
    v('F2 : tout inchangé = AUCUNE écriture', [rap.inchanges, ops.length], [2, 0]);
    ops.length = 0;
    existants = [{ _id: 5, motif: 'une-seule-source', sources: ['scx'] }, { _id: 6, motif: 'sans-offre', sources: [] }];
    rap = await CO.ecrireTrous(fauxDb, [t1, t6]);
    v('F2 : sources changées = réécrit', [rap.changes, ops[0].o.map(x => x.updateOne.filter._id)], [1, [5]]);
    ops.length = 0;
    existants = [{ _id: 5, motif: 'une-seule-source', sources: ['ppr', 'scx'], resolu: true }, { _id: 6, motif: 'sans-offre', sources: [] }];
    rap = await CO.ecrireTrous(fauxDb, [t1, t6]);
    v('F4 : un trou résolu qui redevient manquant : resolu:false (même motif et mêmes sources)', [rap.rouverts, rap.changes, ops[0].o[0].updateOne.update.$set.resolu], [1, 1, false]);
    ops.length = 0;
    existants = [{ _id: 5, motif: 'une-seule-source', sources: ['ppr', 'scx'] }, { _id: 8, motif: 'illisible', sources: ['scx'] }, { _id: 9, motif: 'illisible', sources: ['scx'] }, { _id: 10, motif: 'illisible', sources: ['scx'] }, { _id: 11, motif: 'illisible', sources: ['scx'], resolu: true }];
    const clv = new Map([[5, 'MANQUANT'], [8, 'A_COMPARER'], [9, 'MANQUANT'], [11, 'A_COMPARER']]);                     // 10 : absent de l'état
    rap = await CO.ecrireTrous(fauxDb, [t1], { classeVisuelParId: clv, le });
    v('F4 : résolus = présent dans l\'état ET plus MANQUANT, pas déjà résolu ; absent de l\'état = on ne sait pas', [rap.resolus, ops[0].o.map(x => [x.updateOne.filter._id, x.updateOne.update.$set])], [1, [[8, { resolu: true, resoluLe: le }]]]);
    vrai('F4 : jamais de suppression', ops[0].o.every(x => !x.deleteOne));
    ops.length = 0;
    existants = [{ _id: 5, motif: 'une-seule-source', sources: ['ppr', 'scx'] }];
    rap = await CO.ecrireTrous(fauxDb, [t1], { classeVisuelParId: new Map([[5, 'A_COMPARER']]), le });
    v('F4 : un trou réécrit ce soir (donc manquant) n\'est jamais résolu même si l\'état dit le contraire', rap.resolus, 0);
    ops.length = 0; existants = [];
    await leve('ecrireTrous : un trou au motif hors liste fabriqué à la main : rien n\'est écrit', () => CO.ecrireTrous(fauxDb, [t1, { ...t1, idProduct: 9, motif: 'bidon' }]), /motif/);
    v('ecrireTrous : refus AVANT toute écriture', ops.length, 0);

    // ───────────── R3 : le tirage du PRODUIT ─────────────
    v('langueDuTirage : intl', CO.langueDuTirage('intl'), 'en');
    v('langueDuTirage : jp', CO.langueDuTirage('jp'), 'ja');
    v('langueDuTirage : zh-hans', CO.langueDuTirage('zh-hans'), 'zh-hans');
    v('langueDuTirage : zh-hant', CO.langueDuTirage('zh-hant'), 'zh-hant');
    v('langueDuTirage : id', CO.langueDuTirage('id'), 'id');
    v('langueDuTirage : th', CO.langueDuTirage('th'), 'th');
    v('langueDuTirage : idth (deux langues) = null, EXCLUT', CO.langueDuTirage('idth'), null);
    v('langueDuTirage : inconnu = null', CO.langueDuTirage('klingon'), null);
    v('langueDuTirage : absent = null', CO.langueDuTirage(undefined), null);
    v('langueDuTirage : hérité de Object.prototype = null (constructor)', CO.langueDuTirage('constructor'), null);
    v('tirageProduit', CO.tirageProduit({ langue: 'intl', tamponnee: null, codeSet: 'PAL', numero: '012' }), { langue: 'en', codeSet: 'PAL', numero: '012', tampon: null });
    v('tirageProduit : numéro « 012/193 » réduit avant le « / »', CO.tirageProduit({ langue: 'intl', codeSet: 'PAL', numero: '012/193' }).numero, '012');
    v('tirageProduit : tamponnée gardée telle quelle', CO.tirageProduit({ langue: 'intl', tamponnee: 'pps', codeSet: 'X', numero: '1' }).tampon, 'pps');
    v('tirageProduit : tout absent = null partout', CO.tirageProduit({}), { langue: null, codeSet: null, numero: null, tampon: null });

    // ───────────── R2 : le tirage du CANDIDAT = ce que la SOURCE dit ─────────────
    const dScx = def('scx');
    v('tirageCandidat : « 024/208 » -> « 024 », codeSet null (le groupe est NOTRE code)', CO.tirageCandidat(dScx, unite({ numeroSource: '024/208', groupe: 'PAL' })), { langue: 'en', numero: '024', codeSet: null, tampon: null });
    v('tirageCandidat : numéro sans « / »', CO.tirageCandidat(dScx, unite({ numeroSource: '024' })).numero, '024');
    v('tirageCandidat : numeroSource absent = null (jamais NOTRE numéro)', CO.tirageCandidat(dScx, unite({ numeroSource: undefined, numero: '999' })).numero, null);
    v('tirageCandidat : numeroSource vide = null', CO.tirageCandidat(dScx, unite({ numeroSource: '  ' })).numero, null);
    v('tirageCandidat : numeroSource numérique', CO.tirageCandidat(dScx, unite({ numeroSource: 24 })).numero, '24');
    v('tirageCandidat : langue = celle de la SOURCE, pas celle du set', CO.tirageCandidat(def('ppr', { langue: 'zh-hans' }), unite({})).langue, 'zh-hans');
    v('tirageCandidat : tampon de la source (tampon(slugSet))', CO.tirageCandidat(def('scx', { tampon: s => (s === 'Set-A' ? 'Play! Pokémon' : undefined) }), unite({ slugSet: 'Set-A' })).tampon, 'Play! Pokémon');
    v('tirageCandidat : tampon indéfini = null', CO.tirageCandidat(def('scx', { tampon: () => undefined }), unite({})).tampon, null);

    // ───────────── regroupement par produit ─────────────
    const ids = new Set([100, 101, 102]);
    const uA = unite({ produits: [100], url: 'https://x/a.jpg' }), uB = unite({ produits: [999], url: 'https://x/b.jpg' }), uC = unite({ produits: [101], url: 'https://x/c.jpg', decision: { action: 'cede' } });
    const uD = unite({ produits: [100, 101], url: 'https://x/d.jpg', carteId: 2 }), uE = unite({ produits: [102], url: 'https://x/e.jpg', decision: { action: 'deja-posee' } });
    const g = CO.regrouperUnites([{ code: 'scx', unites: [uA, uB, uC, uD, uE] }, { code: 'ppr', unites: [unite({ produits: [100], url: 'https://y/a.jpg' })] }], ids);
    v('regrouper : produit 100 = ses deux unités scx (uA, uD) + celle de ppr', (g.get(100) || []).map(e => `${e.code}:${e.unite.url.slice(-5)}`), ['scx:a.jpg', 'scx:d.jpg', 'ppr:a.jpg']);
    v('regrouper : une unité à DEUX produits compte pour chacun', (g.get(101) || []).map(e => e.unite.url.slice(-5)), ['d.jpg']);
    v('regrouper : unité hors population (999) ignorée', g.has(999), false);
    v('regrouper : `cede` ignorée', (g.get(101) || []).some(e => e.unite === uC), false);
    v('regrouper : `deja-posee` ignorée (seule `ajouter` compte)', g.has(102), false);
    v('regrouper : unité sans décision ignorée', CO.regrouperUnites([{ code: 'scx', unites: [{ ...uA, decision: undefined }] }], ids).size, 0);

    // un fournisseur qui propose DEUX adresses pour un produit : ambigu, écarté (jamais deviné)
    const dbl = CO.candidatsDuProduit([{ code: 'scx', unite: unite({ url: 'https://x/1.jpg' }) }, { code: 'scx', unite: unite({ url: 'https://x/2.jpg', carteId: 3 }) }, { code: 'ppr', unite: unite({ url: 'https://y/1.jpg' }) }]);
    v('candidatsDuProduit : deux adresses d\'un même fournisseur = ambigu, écarté', [dbl.candidats.map(c => c.code), dbl.ambigus], [['ppr'], ['scx']]);
    const meme = CO.candidatsDuProduit([{ code: 'scx', unite: unite({ url: 'https://x/1.jpg' }) }, { code: 'scx', unite: unite({ url: 'https://x/1.jpg', carteId: 3 }) }]);
    v('candidatsDuProduit : la MÊME adresse deux fois n\'est pas ambiguë', [meme.candidats.length, meme.ambigus], [1, []]);

    // ───────────── R4 : classer — 0 / 1 / ≥ 2 sources, sources bloquées ─────────────
    const ordre = ['scx', 'ppr', 'pmk', 'tcs'];
    const cand = (...codes) => codes.map(c => ({ code: c, unite: unite({ url: `https://${c}/1.jpg` }) }));
    const cl = (codes, bloques = [], ambigus = []) => CO.classerProduit({ candidats: cand(...codes), ambigus }, new Set(bloques), ordre);
    v('classer : aucun candidat', cl([]), { action: 'trou', motif: 'aucune-source' });
    v('classer : UNE source = trou direct (R4, 0 requête)', cl(['scx']), { action: 'trou', motif: 'une-seule-source' });
    v('classer : deux sources = à télécharger', cl(['scx', 'ppr']), { action: 'telecharger', sources: ['scx', 'ppr'] });
    v('classer : trois sources', cl(['scx', 'ppr', 'pmk']).sources, ['scx', 'ppr', 'pmk']);
    v('classer : une source seule + une bloquée = source-bloquee (la cause)', cl(['scx', 'tcs'], ['tcs']), { action: 'trou', motif: 'source-bloquee:tcs' });
    v('classer : uniquement une source bloquée', cl(['tcs'], ['tcs']), { action: 'trou', motif: 'source-bloquee:tcs' });
    v('classer : trois sources dont une bloquée = deux restantes, à télécharger SANS la bloquée', cl(['scx', 'ppr', 'tcs'], ['tcs']), { action: 'telecharger', sources: ['scx', 'ppr'] });
    v('classer : deux bloquées, 1 libre : la première du registre nomme le motif', cl(['scx', 'pmk', 'tcs'], ['pmk', 'tcs']).motif, 'source-bloquee:pmk');
    v('classer : une source libre + une AMBIGUË = discordance-image (jamais deviné)', cl(['scx'], [], ['ppr']), { action: 'trou', motif: 'discordance-image' });
    v('classer : zéro candidat mais source bloquée sans unité : aucune-source', cl([], ['tcs']), { action: 'trou', motif: 'aucune-source' });

    // ───────────── R1 : la population ─────────────
    const etat = [
        { idProduct: 1, classeVisuel: 'MANQUANT', classeFiche: 'FICHE_OK', langue: 'intl', name: 'A', tamponnee: null },
        { idProduct: 2, classeVisuel: 'MANQUANT', classeFiche: 'SANS_LIGNE', langue: 'intl', name: 'B' },          // pas de fiche : hors population
        { idProduct: 3, classeVisuel: 'PRESENT', classeFiche: 'FICHE_OK', langue: 'intl', name: 'C' },             // un visuel : hors population
        { idProduct: 4, classeVisuel: 'MANQUANT', classeFiche: 'FICHE_DOUTEUSE', langue: 'jp', name: 'D' },         // fiche douteuse : dans la population
        { idProduct: 5, classeVisuel: 'MANQUANT', classeFiche: 'LIGNE_SANS_FICHE', langue: 'intl', name: 'E' },     // sans offre
        { idProduct: 6, classeVisuel: 'MANQUANT', classeFiche: 'FICHE_OK', langue: 'intl', name: 'F' },             // sans offre mais NEUF
        { idProduct: 7, classeVisuel: 'MANQUANT', classeFiche: 'FICHE_OK', langue: 'intl', name: 'G' }              // absent du guide
    ];
    const guide = new Map([[1, { low: 1, avg1: 1 }], [4, { low: 2, avg7: 1 }], [5, { avg1: 1 }], [6, { avg30: 1 }]]);
    const numeros = new Map([[1, { codeSet: 'PAL', numero: '1' }], [4, { codeSet: 'S1', numero: '4' }]]);
    let pop = CO.choisirPopulation({ etat, guide, numeros, neufs: new Set([6]), limite: 200 });
    v('population : base = MANQUANT et fiche existante', pop.base, 5);
    v('population : cherchés = offre ou NEUF, par popularité', pop.cibles.map(c => c.idProduct), [1, 4, 6]);
    v('population : sans offre non neufs = trous sans-offre, sans recherche', pop.sansOffre.map(c => c.idProduct).sort(), [5, 7]);
    v('population : le neuf sans offre est marqué neuf', pop.cibles.find(c => c.idProduct === 6).neuf, true);
    v('population : codeSet et numéro lus de numeros_cartes', [pop.cibles[0].codeSet, pop.cibles[0].numero], ['PAL', '1']);
    v('population : numeros_cartes manquant = null (le tirage exclura)', [pop.cibles[2].codeSet, pop.cibles[2].numero], [null, null]);
    v('F1 : la population ne porte plus de plafond (il compte les produits à ≥ 2 sources)', pop.reportes, undefined);
    pop = CO.choisirPopulation({ etat, guide, numeros, neufs: new Set(), limite: 200 });
    v('population : sans neuf, le produit 6 (sans offre) est un trou sans-offre', pop.sansOffre.map(c => c.idProduct).sort(), [5, 6, 7]);
    await leve('population : état vide = instrument cassé (§41)', () => CO.choisirPopulation({ etat: [], guide, numeros, neufs: new Set(), limite: 5 }), /VIDE/);
    await leve('population : aucun MANQUANT dans un état non vide = filtre qui ne mord pas (§41)', () => CO.choisirPopulation({ etat: [{ idProduct: 1, classeVisuel: 'PRESENT', classeFiche: 'FICHE_OK' }], guide, numeros, neufs: new Set(), limite: 5 }), /MANQUANT/);

    // ───────────── R6 : le gagnant ─────────────
    const cG = [{ code: 'scx', unite: unite({ url: 'u1' }) }, { code: 'ppr', unite: unite({ url: 'u2' }) }, { code: 'pmk', unite: unite({ url: 'u3' }) }];
    const larg = { u1: 400, u2: 700, u3: 900 };
    v('gagnant : le plus LARGE des DEUX sources de la paire (pas de la troisième)', CO.choisirGagnant({ paireSources: ['scx', 'ppr'], candidats: cG, largeurDe: u => larg[u.url], ordre }).code, 'ppr');
    v('gagnant : inversé', CO.choisirGagnant({ paireSources: ['ppr', 'scx'], candidats: cG, largeurDe: u => larg[u.url], ordre }).code, 'ppr');
    v('gagnant : égalité = l\'ordre du registre', CO.choisirGagnant({ paireSources: ['ppr', 'scx'], candidats: cG, largeurDe: () => 500, ordre }).code, 'scx');
    v('gagnant : largeur absente = 0', CO.choisirGagnant({ paireSources: ['scx', 'ppr'], candidats: cG, largeurDe: u => (u.url === 'u1' ? undefined : 300), ordre }).code, 'ppr');
    v('gagnant : la troisième source plus large ne gagne pas', CO.choisirGagnant({ paireSources: ['scx', 'ppr'], candidats: cG, largeurDe: u => larg[u.url], ordre }).code !== 'pmk', true);
    await leve('gagnant : une source de la paire absente des candidats', () => CO.choisirGagnant({ paireSources: ['scx', 'zzz'], candidats: cG, largeurDe: () => 1, ordre }), /paire/);
    await leve('gagnant : paireSources absente', () => CO.choisirGagnant({ paireSources: undefined, candidats: cG, largeurDe: () => 1, ordre }), /paire/);

    // ───────────── jugerProduit (décideur injecté) ─────────────
    const defs = new Map([['scx', def('scx')], ['ppr', def('ppr')], ['pmk', def('pmk')]]);
    const produit = { langue: 'en', codeSet: 'PAL', numero: '024', tampon: null };
    const mk = (jug, decideur) => CO.jugerProduit({ produit, candidats: cG.slice(0, 2), defs, jugement: u => jug[u.url], octets: () => Buffer.from('x'), decider: decideur, ordre });
    const decideEcrire = async ({ candidats }) => ({ decision: 'ecrire', preuve: { regle: 'strict', paireSources: candidats.map(c => c.source), candidats: candidats.length } });
    let r = await mk({ u1: { statut: 'ok', w: 400 }, u2: { statut: 'ok', w: 700 } }, decideEcrire);
    v('juger : ecrire -> le gagnant est la source la plus large', [r.decision, r.gagnant.code], ['ecrire', 'ppr']);
    r = await mk({ u1: { statut: 'ok', w: 400 }, u2: { statut: 'ok', w: 700 } }, async () => ({ decision: 'a-confirmer', preuve: { regle: 'souple-seule' } }));
    v('juger : a-confirmer -> motif a-confirmer, pas de gagnant', [r.decision, r.motif, r.gagnant], ['a-confirmer', 'a-confirmer', undefined]);
    r = await mk({ u1: { statut: 'ok', w: 400 }, u2: { statut: 'ok', w: 700 } }, async () => ({ decision: 'trou', motif: 'discordance-image', preuve: {} }));
    v('juger : trou de la règle d\'image garde son motif', [r.decision, r.motif], ['trou', 'discordance-image']);
    r = await mk({ u1: { statut: 'ok', w: 400 }, u2: { statut: 'trop-petit', w: 120 } }, async ({ candidats }) => ({ decision: 'trou', motif: candidats.length ? 'une-seule-source' : 'aucune-source', preuve: {} }));
    v('juger : une image sous le seuil retire la source -> sous-le-seuil', [r.decision, r.motif], ['trou', 'sous-le-seuil']);
    r = await mk({ u1: { statut: 'ok', w: 400 }, u2: { statut: 'absent' } }, async () => ({ decision: 'trou', motif: 'une-seule-source', preuve: {} }));
    v('juger : une image absente retire la source -> illisible', [r.decision, r.motif], ['trou', 'illisible']);
    r = await mk({ u1: { statut: 'ok', w: 400 }, u2: { statut: 'forme-inattendue', w: 300, h: 300 } }, async () => ({ decision: 'trou', motif: 'une-seule-source', preuve: {} }));
    v('juger : forme inattendue -> illisible', r.motif, 'illisible');
    r = await mk({ u1: { statut: 'ok', w: 400 } }, decideEcrire);
    v('juger : une adresse jamais téléchargée (plafond) = reporté, JAMAIS un trou ni un visuel', [r.decision, r.motif], ['reporte', undefined]);
    r = await CO.jugerProduit({ produit, candidats: cG.slice(0, 2), defs, jugement: () => ({ statut: 'ok', w: 400 }), octets: (c) => (c === 'scx' ? null : Buffer.from('x')), decider: decideEcrire, ordre });
    v('juger : octets absents du cache = source retirée -> illisible, jamais ecrire', [r.decision, r.motif], ['trou', 'illisible']);
    r = await mk({ u1: { statut: 'ok', w: 400 }, u2: { statut: 'ok', w: 700 } }, async () => ({ decision: 'ecrire', preuve: { regle: 'strict' } }));
    v('juger : ecrire SANS paireSources (règle incomplète) : fermé, a-confirmer', [r.decision, r.motif], ['a-confirmer', 'a-confirmer']);
    // le décideur reçoit le tirage du CANDIDAT selon R2 et AUCUN scan conforme (R5)
    let vu = null;
    await mk({ u1: { statut: 'ok', w: 400 }, u2: { statut: 'ok', w: 700 } }, async (e) => { vu = e; return { decision: 'trou', motif: 'discordance-image', preuve: {} }; });
    v('juger : tirage du candidat (R2) transmis, codeSet null', vu.candidats.map(c => [c.source, c.tirage.numero, c.tirage.codeSet, c.tirage.langue]), [['scx', '024', null, 'en'], ['ppr', '024', null, 'en']]);
    v('juger : R5, aucun scan conforme (un produit MANQUANT n\'a par définition aucun visuel au même set/numéro/langue)', vu.scansConformes ?? [], []);
    v('juger : le produit transmis est celui du tirage du PRODUIT', vu.produit, produit);

    // ── avec la VRAIE règle d'image sur des images fabriquées : tirage différent / même source ──
    const graine = s => { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; };
    const fabrique = (seed, l = 300, h = 420) => { const rn = graine(seed), b = Buffer.alloc(l * h * 3, 128); for (let k = 0; k < 220; k++) { const x0 = Math.floor(rn() * (l - 20)), y0 = Math.floor(rn() * (h - 20)), w = 8 + Math.floor(rn() * 60), hh = 8 + Math.floor(rn() * 60), c = Math.floor(rn() * 256); for (let y = y0; y < Math.min(h, y0 + hh); y++) for (let x = x0; x < Math.min(l, x0 + w); x++) { const o = (y * l + x) * 3; b[o] = b[o + 1] = b[o + 2] = c; } } return sharp(b, { raw: { width: l, height: h, channels: 3 } }); };
    const IA = await fabrique(7).png().toBuffer(), IA2 = await sharp(IA).webp({ lossless: true }).toBuffer(), IB = await fabrique(99).png().toBuffer();
    const octetsDe = { u1: IA, u2: IA2 };
    const reel = (prod, jug = { u1: { statut: 'ok', w: 300 }, u2: { statut: 'ok', w: 300 } }) => CO.jugerProduit({ produit: prod, candidats: cG.slice(0, 2), defs, jugement: u => jug[u.url], octets: (c, u) => octetsDe[u.url], ordre });
    r = await reel({ langue: 'en', codeSet: 'PAL', numero: '024', tampon: null });
    v('vraies images : même image, même tirage, deux sources : écrire, paireSources nommée', [r.decision, r.preuve.paireSources], ['ecrire', ['scx', 'ppr']]);
    r = await reel({ langue: 'ja', codeSet: 'PAL', numero: '024', tampon: null });
    v('vraies images : produit d\'une AUTRE langue : jamais écrit (tirage-different)', [r.decision, r.motif], ['trou', 'tirage-different']);
    r = await reel({ langue: 'en', codeSet: 'PAL', numero: '025', tampon: null });
    v('vraies images : numéro du produit différent de celui de la source : tirage-different', [r.decision, r.motif], ['trou', 'tirage-different']);
    r = await reel({ langue: null, codeSet: 'PAL', numero: '024', tampon: null });
    v('vraies images : langue du produit inconnue : exclu', [r.decision, r.motif], ['trou', 'tirage-different']);
    octetsDe.u2 = IB;
    r = await reel({ langue: 'en', codeSet: 'PAL', numero: '024', tampon: null });
    v('vraies images : deux images différentes : discordance-image', [r.decision, r.motif], ['trou', 'discordance-image']);

    // ───────────── planifier : tout le plan, 0 requête ─────────────
    const cibles = [
        { idProduct: 100, name: 'P100', langue: 'intl', codeSet: 'PAL', numero: '024', pop: {}, tamponnee: null },
        { idProduct: 101, name: 'P101', langue: 'intl', codeSet: 'PAL', numero: '025', pop: {}, tamponnee: null },
        { idProduct: 102, name: 'P102', langue: 'intl', codeSet: 'PAL', numero: '026', pop: {}, tamponnee: null },
        { idProduct: 103, name: 'P103', langue: 'intl', codeSet: 'PAL', numero: '027', pop: {}, tamponnee: null },
        { idProduct: 104, name: 'P104', langue: 'intl', codeSet: 'PAL', numero: '028', pop: {}, tamponnee: null }
    ];
    const U = (p, code) => unite({ produits: [p], url: `https://${code}/${p}.jpg`, carteId: p });
    const parFournisseur = [
        { code: 'scx', bloquee: false, unites: [U(100, 'scx'), U(101, 'scx'), U(102, 'scx')] },
        { code: 'ppr', bloquee: false, unites: [U(100, 'ppr'), U(101, 'ppr')] },
        { code: 'tcs', bloquee: true, unites: [U(102, 'tcs'), U(103, 'tcs')] }
    ];
    const pl = CO.planifier({ cibles, parFournisseur, ordre });
    v('planifier : produits à télécharger (≥ 2 sources libres)', pl.produits.map(p => p.idProduct), [100, 101]);
    v('F1 : sans plafond, aucun reporté', pl.reportes, []);
    const motifs = Object.fromEntries(pl.trousDirects.map(t => [t.idProduct, t.motif]));
    v('planifier : trous directs (102 une seule source libre + bloquée ; 103 bloquée seule ; 104 aucune)', motifs, { 102: 'source-bloquee:tcs', 103: 'source-bloquee:tcs', 104: 'aucune-source' });
    v('planifier : les sources interrogées sont celles du registre (jamais un nom en dur)', pl.trousDirects[0].sources, ordre);
    v('planifier : comptes 0 / 1 / ≥2 / bloquées', pl.comptes, { aucune: 1, une: 0, deuxPlus: 2, bloquees: 2 });
    v('planifier : une unité d\'une source bloquée n\'est JAMAIS à télécharger', pl.produits.flatMap(p => p.candidats.map(c => c.code)).includes('tcs'), false);
    v('planifier : le candidat porte son unité complète (carteId, slugSet, url)', Object.keys(pl.produits[0].candidats[0].unite).includes('slugSet'), true);

    // F1 : le plafond ne compte QUE les produits à ≥ 2 sources ; 0 / 1 source et sans-offre sont nommés en entier
    const beaucoup = [];
    for (let i = 0; i < 250; i++) beaucoup.push({ idProduct: 1000 + i, name: 'N' + i, langue: 'intl', codeSet: 'PAL', numero: String(i), pop: {}, tamponnee: null });
    for (const i of [1, 2, 3]) beaucoup.push({ idProduct: 5000 + i, name: 'D' + i, langue: 'intl', codeSet: 'PAL', numero: String(i), pop: {}, tamponnee: null });
    const trie = [...beaucoup.slice(0, 100), ...beaucoup.slice(250), ...beaucoup.slice(100, 250)];          // des 2-sources mêlés dans la file par popularité
    const U2 = (p, code) => unite({ produits: [p], url: `https://${code}/${p}.jpg`, carteId: p });
    const plL = CO.planifier({ cibles: trie, limite: 2, ordre, parFournisseur: [{ code: 'scx', bloquee: false, unites: [5001, 5002, 5003].map(p => U2(p, 'scx')) }, { code: 'ppr', bloquee: false, unites: [5001, 5002, 5003].map(p => U2(p, 'ppr')) }] });
    v('F1 : limite 2, 3 produits à 2 sources : les 2 premiers par popularité sont à télécharger', plL.produits.map(p => p.idProduct), [5001, 5002]);
    v('F1 : le 3e est REPORTÉ (ni trou ni visuel)', plL.reportes, [5003]);
    v('F1 : les 250 « aucune-source » sont TOUS nommés malgré la limite', [plL.trousDirects.length, plL.trousDirects.every(t => t.motif === 'aucune-source'), plL.comptes.aucune], [250, true, 250]);
    v('F1 : le reporté n\'a pas de trou', plL.trousDirects.some(t => t.idProduct === 5003), false);
    await leve('F1 : limite invalide', () => CO.planifier({ cibles: trie, limite: 0, ordre, parFournisseur: [] }), /limite/);

    // F3 : le fichier d'état que le compteur vient d'écrire = celui qui n'existait pas avant
    v('F3 : le nouvel état = le fichier apparu', CO.choisirNouvelEtat(['etat-abc-2026-10-25-1902.json', 'historique.jsonl'], ['etat-abc-2026-10-25-1902.json', 'etat-abc-2026-10-26-0815.json', 'abc-2026-10-26-0815.json', 'historique.jsonl']), 'etat-abc-2026-10-26-0815.json');
    await leve('F3 : aucun fichier neuf (le compteur n\'a rien écrit) : refus', () => CO.choisirNouvelEtat(['etat-abc-2026-10-25-1902.json'], ['etat-abc-2026-10-25-1902.json']), /aucun/);
    v('F3 : deux fichiers neufs = le plus récent par le nom', CO.choisirNouvelEtat([], ['etat-abc-2026-10-26-0815.json', 'etat-abc-2026-10-26-0915.json']), 'etat-abc-2026-10-26-0915.json');
    const sp = (status) => CO.regenererEtat({ lister: (() => { let n = 0; return () => (n++ ? ['etat-abc-2026-10-26-0815.json'] : []); })(), lancer: () => ({ status }) });
    v('F3 : le compteur réussit -> son fichier', sp(0), 'etat-abc-2026-10-26-0815.json');
    await leve('F3 : le compteur échoue (code 1) : arrêt', async () => sp(1), /compteur/);
    await leve('F3 : le compteur tué (status null) : arrêt', async () => sp(null), /compteur/);
    await leve('F3 : le compteur rend 0 mais n\'écrit rien : arrêt', () => CO.regenererEtat({ lister: () => ['etat-abc-2026-10-25-1902.json'], lancer: () => ({ status: 0 }) }), /aucun/);

    // ── R4 : le téléchargement ne demande QUE les unités des produits à ≥ 2 sources ──
    const lancements = [];
    const faux = (code, bloque = false) => ({ code, def: def(code, { clientDe: () => { if (bloque) throw new Error(`le client de ${code} (hôte fermé) ne doit JAMAIS être construit`); return { requetes: () => 0, requetesParHote: () => ({}), codes: () => ({}) }; } }) });
    const fournis = [faux('scx'), faux('ppr'), faux('tcs', true)];
    const rec = { telecharger: async ({ SRC: s, unites }) => { lancements.push({ s: s.SOURCE, urls: unites.map(u => u.url).sort() }); return { etat: 'termine', requetes: unites.length, adresses: unites.length, parStatut: {}, restantes: 0, tropPetits: [], transitoires: 0 }; } };
    const imprime = [];
    const tp = await CO.telechargerPlan({ plan: { produits: pl.produits, fournisseurs: parFournisseur.map(f => ({ code: f.code, bloquee: f.bloquee })) }, fournisseurs: fournis, plafond: 50, fichiersDe: (code) => ({ images: `/n/images-${code}.json`, cache: `/n/cache-${code}`, progression: `/n/p-${code}.json` }),
        telecharger: rec.telecharger, arret: (hote) => (/tcs/.test(hote) ? { motif: 'robots 403' } : null), maximumImages: ({ unites }) => ({ total: unites.length + 1, detail: 'faux', secondes: 6, plafondTotal: 50, dejaAuCache: 0 }), indexDe: () => ({}), journal: m => imprime.push(m) });
    v('telechargerPlan : scx = ses 2 unités des produits à ≥ 2 sources (pas 102 qui n\'a qu\'une source libre)', lancements.find(l => l.s === 'scx').urls, ['https://scx/100.jpg', 'https://scx/101.jpg']);
    v('telechargerPlan : ppr = ses 2 unités', lancements.find(l => l.s === 'ppr').urls, ['https://ppr/100.jpg', 'https://ppr/101.jpg']);
    v('telechargerPlan : la source bloquée n\'est jamais lancée ni son client construit', lancements.some(l => l.s === 'tcs'), false);
    v('telechargerPlan : rapport par fournisseur', tp.map(x => [x.code, x.etat]), [['scx', 'termine'], ['ppr', 'termine']]);
    vrai('telechargerPlan : le maximum de requêtes est imprimé AVANT le premier téléchargement', imprime.length > 0 && imprime[0].includes('MAXIMUM'));
    vrai('telechargerPlan : la ligne de la source fermée dit 0 requête', imprime.some(m => /tcs/.test(m) && /0 requête/.test(m)));
    // un plan sans aucun produit à télécharger ne lance rien
    lancements.length = 0;
    await CO.telechargerPlan({ plan: { produits: [], fournisseurs: [] }, fournisseurs: fournis, plafond: 50, fichiersDe: () => ({}), telecharger: rec.telecharger, arret: () => null, maximumImages: () => ({ total: 0 }), indexDe: () => ({}), journal: () => {} });
    v('telechargerPlan : plan sans produit : 0 lancement', lancements.length, 0);

    // ── recolterUnites : une source bloquée sort SANS aucune requête ; un plan en échec arrête tout ──
    let appels = 0;
    const unitesPlan = async () => { appels++; return { unites: [U(102, 'tcs')], restes: [] }; };
    const bloquee = { code: 'tcs', def: def('tcs', { construirePlan: unitesPlan }) };
    const rr = await CO.recolterUnites({ fournisseurs: [bloquee, { code: 'scx', def: def('scx', { construirePlan: async () => ({ unites: [U(100, 'scx'), { ...U(101, 'scx'), decision: { action: 'cede' } }], restes: [] }) }) }], db: {}, lireReleves: () => ({}), arret: h => (/tcs/.test(h) ? { motif: 'x' } : null) });
    v('recolterUnites : source bloquée marquée, ses unités lues (0 requête) mais jamais téléchargeables', rr.map(x => [x.code, x.bloquee, x.unites.length]), [['tcs', true, 1], ['scx', false, 2]]);
    await leve('recolterUnites : le plan d\'un fournisseur échoue : tout s\'arrête (jamais « aucune source »)', () => CO.recolterUnites({ fournisseurs: [{ code: 'scx', def: def('scx', { construirePlan: async () => { throw new Error('boum'); } }) }], db: {}, lireReleves: () => ({}), arret: () => null }), /scx.*boum/);

    // ───────────── l'assemblage : décisions -> visuels + trous ─────────────
    const uW = U(100, 'ppr');
    const verdicts = [
        { idProduct: 100, decision: 'ecrire', gagnant: { code: 'ppr', unite: { ...uW, produits: [100, 105] } }, preuve: { regle: 'strict' } },
        { idProduct: 101, decision: 'trou', motif: 'discordance-image', preuve: { paires: [] } },
        { idProduct: 105, decision: 'trou', motif: 'illisible', preuve: {} },            // couvert par l'unité gagnante de 100 (même carte) : pas de trou
        { idProduct: 106, decision: 'a-confirmer', motif: 'a-confirmer', preuve: { regle: 'souple-seule' } },
        { idProduct: 107, decision: 'reporte' }
    ];
    const asm = CO.assembler({ verdicts, trousDirects: [CO.construireTrou({ idProduct: 104, motif: 'aucune-source', sources: ordre, preuve: {}, le })], sansOffre: [{ idProduct: 5 }], ordre, le });
    v('assembler : les gagnants par fournisseur (une unité, dédoublonnée)', Object.fromEntries(Object.entries(asm.gagnants).map(([k, l]) => [k, l.length])), { ppr: 1 });
    v('assembler : les trous (directs + jugés + a-confirmer + sans-offre), sauf les produits couverts par une unité gagnante', asm.trous.map(t => `${t.idProduct}:${t.motif}`).sort(), ['101:discordance-image', '104:aucune-source', '106:a-confirmer', '5:sans-offre']);
    v('assembler : reportés comptés, sans trou', asm.reportes, [107]);
    v('assembler : tous les motifs sont fermés', asm.trous.every(t => CO.motifAdmis(t.motif)), true);
    const asm2 = CO.assembler({ verdicts: [{ idProduct: 1, decision: 'ecrire', gagnant: { code: 'scx', unite: { ...U(1, 'scx'), produits: [1] } }, preuve: {} }, { idProduct: 2, decision: 'ecrire', gagnant: { code: 'scx', unite: { ...U(1, 'scx'), produits: [1, 2] } }, preuve: {} }], trousDirects: [], sansOffre: [], ordre, le });
    v('assembler : la même unité gagnante pour deux produits est écrite UNE fois', asm2.gagnants.scx.length, 1);

    // ───────────── l'écriture : compte d'abord, --attendu faux = rien n'est écrit, trous seulement si tous les visuels sont écrits ─────────────
    const journalEcr = [];
    const defsE = new Map([['scx', def('scx')], ['ppr', def('ppr')]]);
    const gagE = { scx: [U(100, 'scx')], ppr: [U(101, 'ppr'), U(102, 'ppr')] };
    const ecrF = (reelDe, codeDe = () => 0) => async (d, unites, opt) => { journalEcr.push(`${d.CODE}:${opt.compterSeulement ? 'compte' : 'ecrit'}`); return opt.compterSeulement ? { reel: reelDe(d.CODE) } : { code: codeDe(d.CODE), reel: reelDe(d.CODE) }; };
    const poserT = async (ts) => { journalEcr.push(`trous:${ts.length}`); return ts.length; };
    let ex = await CO.executerEcriture({ gagnants: gagE, defs: defsE, attendu: 3, ecrireFournisseur: ecrF(c => (c === 'scx' ? 1 : 2)), ecrireTrous: poserT, trous: [t1] });
    v('écriture : attendu juste -> code 0, ordre compte, compte, écrit, écrit, trous', [ex.code, journalEcr], [0, ['scx:compte', 'ppr:compte', 'scx:ecrit', 'ppr:ecrit', 'trous:1']]);
    journalEcr.length = 0;
    ex = await CO.executerEcriture({ gagnants: gagE, defs: defsE, attendu: 4, ecrireFournisseur: ecrF(c => (c === 'scx' ? 1 : 2)), ecrireTrous: poserT, trous: [t1] });
    v('écriture : --attendu faux -> code 2, RIEN n\'est écrit (ni visuel ni trou)', [ex.code, ex.etat, journalEcr], [2, 'refuse-attendu', ['scx:compte', 'ppr:compte']]);
    journalEcr.length = 0;
    ex = await CO.executerEcriture({ gagnants: gagE, defs: defsE, attendu: 3, ecrireFournisseur: ecrF(c => (c === 'scx' ? 1 : 2), c => (c === 'ppr' ? 1 : 0)), ecrireTrous: poserT, trous: [t1] });
    v('écriture : un fournisseur incomplet -> code 1 et AUCUN trou écrit', [ex.code, ex.etat, journalEcr.includes('trous:1')], [1, 'visuels-incomplets', false]);
    journalEcr.length = 0;
    ex = await CO.executerEcriture({ gagnants: {}, defs: defsE, attendu: 0, ecrireFournisseur: ecrF(() => 0), ecrireTrous: poserT, trous: [t1] });
    v('écriture : aucun visuel, des trous seuls : attendu 0, les trous s\'écrivent', [ex.code, ex.trous, journalEcr], [0, 1, ['trous:1']]);
    journalEcr.length = 0;
    ex = await CO.executerEcriture({ gagnants: {}, defs: defsE, attendu: 5, ecrireFournisseur: ecrF(() => 0), ecrireTrous: poserT, trous: [t1] });
    v('écriture : aucun visuel mais --attendu=5 : refus, aucun trou', [ex.code, journalEcr], [2, []]);

    // ───────────── le registre des fournisseurs, l'état, les neufs, le compte rendu ─────────────
    const reg = CO.chargerFournisseurs();
    v('registre : les quatre fournisseurs, dans l\'ordre', reg.map(f => f.code), ['scx', 'ppr', 'pmk', 'tcs']);
    v('registre : chacun a un hôte d\'images et une langue', reg.every(f => f.def.hoteImages && f.def.SRC.LANGUE), true);
    await leve('registre : un module sans def', () => CO.chargerFournisseurs(['x'], () => ({})), /def/);
    await leve('registre : deux fois le même code', () => CO.chargerFournisseurs(['a', 'b'], () => ({ def: def('scx') })), /double/);
    await leve('registre : vide', () => CO.chargerFournisseurs([], () => ({})), /aucun/);
    v('dernierEtat : le plus récent par la date du nom', CO.dernierEtat(['etat-abc-2026-10-24-2220.json', 'etat-abc-2026-10-25-1902.json', 'abc-2026-10-25-1902.json', 'historique.jsonl']).fichier, 'etat-abc-2026-10-25-1902.json');
    v('dernierEtat : la date lue dans le nom', CO.dernierEtat(['etat-abc-2026-10-25-1902.json']).le.toISOString(), '2026-10-25T19:02:00.000Z');
    await leve('dernierEtat : aucun fichier conforme', () => CO.dernierEtat(['abc-2026-10-25-1902.json', 'etat-abc-x.json']), /aucun/);
    const dates = new Map([[1, new Date('2026-10-25T10:00:00Z')], [2, new Date('2026-10-20T10:00:00Z')], [3, '2026-10-26T01:00:00Z'], [4, 'pas une date']]);
    v('neufs : dateAdded postérieure au dernier passage', [...CO.calculerNeufs(dates, new Date('2026-10-24T00:00:00Z'))].sort(), [1, 3]);
    v('neufs : sans passage précédent personne n\'est neuf', CO.calculerNeufs(dates, null).size, 0);
    v('neufs : date de passage illisible, personne n\'est neuf', CO.calculerNeufs(dates, new Date('x')).size, 0);
    const md = CO.redigerCompteRendu({ date: '2026-10-26', aBlanc: true, etat: { fichier: 'etat-abc-x.json', le: new Date('2026-10-25T19:02:00Z') }, population: { base: 10, cibles: 5, sansOffre: 5, reportes: 0 }, comptesPlan: { aucune: 1 }, trous: [t1], visuels: 2 });
    vrai('compte rendu : dit « À BLANC »', /À BLANC/.test(md));
    vrai('compte rendu : comptes par motif', /une-seule-source/.test(md) && /visuels à écrire : 2/.test(md));
    vrai('F2/F4 : le compte rendu donne nouveaux / changés / inchangés / résolus', /nouveaux 3 · changés 2 · inchangés \(non réécrits\) 7 · résolus \(le produit n'est plus MANQUANT\) 4/.test(CO.redigerCompteRendu({ date: 'd', aBlanc: false, etat: null, population: { base: 0, cibles: 0, sansOffre: 0, reportes: 0 }, comptesPlan: {}, trousEcrits: { nouveaux: 3, changes: 2, inchanges: 7, resolus: 4, rouverts: 1 } })));
    vrai('compte rendu : hors à blanc, ne dit pas « À BLANC »', !/À BLANC/.test(CO.redigerCompteRendu({ date: 'd', aBlanc: false, etat: null, population: { base: 0, cibles: 0, sansOffre: 0, reportes: 0 }, comptesPlan: {} })));

    // ───────────── les gardes avant tout passage ─────────────
    const vg = (o) => CO.verifierGardes({ dossier: '/d', existe: () => false, lancerFileArret: () => ({ status: 0 }), ...o });
    v('gardes : STOP absent et file à l\'arrêt (0) : autorisé', vg({}).ok, true);
    v('gardes : STOP présent : refus', vg({ existe: () => true }).ok, false);
    vrai('gardes : le refus nomme STOP', /STOP/.test(vg({ existe: () => true }).raison));
    v('gardes : file-a-l-arret rend 1 : refus', vg({ lancerFileArret: () => ({ status: 1 }) }).ok, false);
    v('gardes : file-a-l-arret rend 2 (état inconnu) : refus', vg({ lancerFileArret: () => ({ status: 2 }) }).ok, false);
    v('gardes : file-a-l-arret tué par un signal (status null) : refus', vg({ lancerFileArret: () => ({ status: null, signal: 'SIGKILL' }) }).ok, false);
    v('gardes : file-a-l-arret introuvable (error) : refus', vg({ lancerFileArret: () => ({ status: null, error: new Error('ENOENT') }) }).ok, false);
    v('gardes : lancerFileArret lève : refus (une garde qui ne peut pas conclure bloque)', vg({ lancerFileArret: () => { throw new Error('x'); } }).ok, false);
    v('gardes : existe lève : refus', vg({ existe: () => { throw new Error('x'); } }).ok, false);
    v('gardes : sortie « 0 » en chaîne : refus (seul le nombre 0 autorise)', vg({ lancerFileArret: () => ({ status: '0' }) }).ok, false);

    // ───────────── l'âge de l'état A/B/C ─────────────
    v('âge de l\'état : 2 jours, admis', CO.etatTropVieux(new Date('2026-10-24T00:00:00Z'), new Date('2026-10-26T00:00:00Z')), false);
    v('âge de l\'état : 4 jours, refusé pour une écriture', CO.etatTropVieux(new Date('2026-10-22T00:00:00Z'), new Date('2026-10-26T00:00:00Z')), true);
    v('âge de l\'état : date illisible = trop vieux', CO.etatTropVieux(new Date('x'), new Date('2026-10-26T00:00:00Z')), true);
    v('âge de l\'état : date absente = trop vieux', CO.etatTropVieux(null, new Date('2026-10-26T00:00:00Z')), true);

    // ───────────── la grammaire des arguments ─────────────
    const ga = (...a) => CO.verifierArguments(a);
    v('grammaire : --plan seul', ga('--plan'), null);
    v('grammaire : --plan --limite=20', ga('--plan', '--limite=20'), null);
    v('grammaire : --telecharger --plafond=50', ga('--telecharger', '--plafond=50'), null);
    v('grammaire : --decider', ga('--decider'), null);
    v('grammaire : --ecrire --attendu=3', ga('--ecrire', '--attendu=3'), null);
    v('grammaire : --nuit', ga('--nuit'), null);
    v('grammaire : --nuit --a-blanc --limite=20 --dossier=X', ga('--nuit', '--a-blanc', '--limite=20', '--dossier=C:\\x'), null);
    v('grammaire : --nuit --plafond=300', ga('--nuit', '--plafond=300'), null);
    for (const [nom, args] of [['argument inconnu', ['--plan', '--bidon']], ['argument inconnu seul', ['--oups']], ['aucun mode', []], ['deux modes', ['--plan', '--decider']], ['--telecharger sans plafond', ['--telecharger']],
        ['--ecrire sans attendu', ['--ecrire']], ['--attendu hors --ecrire', ['--plan', '--attendu=3']], ['--a-blanc hors --nuit', ['--plan', '--a-blanc']], ['--limite avec --decider', ['--decider', '--limite=5']],
        ['--plafond avec --plan', ['--plan', '--plafond=5']], ['--limite=0', ['--plan', '--limite=0']], ['--limite non numérique', ['--plan', '--limite=abc']], ['--limite négative', ['--plan', '--limite=-5']], ['--plafond=999999', ['--telecharger', '--plafond=999999']],
        ['--attendu non numérique', ['--ecrire', '--attendu=x']], ['--dossier vide', ['--plan', '--dossier=']], ['casse (--PLAN)', ['--PLAN']], ['--ecrire avec --a-blanc', ['--ecrire', '--attendu=1', '--a-blanc']], ['mode et --nuit', ['--nuit', '--ecrire', '--attendu=1']]])
        vrai(`grammaire : refus — ${nom}`, typeof ga(...args) === 'string');
    await leve('verifierChemin : un dossier d\'apports manuels', () => CO.dossierDe(['--plan', '--dossier=C:\\Users\\Yung\\Desktop\\LOGO\\x']), /apports manuels/);
    await leve('verifierChemin : Logo FR', () => CO.dossierDe(['--plan', '--dossier=D:\\Logo FR']), /apports manuels/);

    // ───────────── la ligne de commande réelle (processus fils, AUCUNE connexion) ─────────────
    const racine = __dirname;
    const envPropre = { ...process.env };
    for (const k of Object.keys(envPropre)) if (/MONGODB|R2_|LOT_ADDITIF/i.test(k)) delete envPropre[k];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comblement-banc-'));
    const fils = (args, env = envPropre) => spawnSync(process.execPath, [path.join(racine, 'comblement-nocturne.js'), ...args], { cwd: racine, env, encoding: 'utf8', timeout: 60000 });
    let f = fils(['--bidon']);
    v('CLI : argument inconnu -> code 2', f.status, 2);
    vrai('CLI : le message nomme l\'argument', /--bidon/.test(f.stderr));
    f = fils(['--plan', '--decider']);
    v('CLI : deux modes -> code 2', f.status, 2);
    f = fils(['--ecrire', '--attendu=1', `--dossier=${tmp}`]);
    v('CLI : --ecrire hors lot-additif -> refus (code ≠ 0)', f.status !== 0 && f.status !== null, true);
    vrai('CLI : --ecrire hors lot-additif nomme lot-additif.js', /lot-additif/.test(f.stderr));
    f = fils(['--ecrire', '--attendu=1', `--dossier=${tmp}`], { ...envPropre, LOT_ADDITIF_PID: '1' });
    v('CLI : --ecrire sous un LOT_ADDITIF_PID qui n\'est pas celui du père -> refus', f.status !== 0 && f.status !== null, true);
    vrai('CLI : ce refus nomme aussi lot-additif.js', /lot-additif/.test(f.stderr));
    f = fils(['--plan', `--dossier=${tmp}`]);
    v('CLI : --plan sans la connexion de LECTURE seule -> refus nommé, code 1 (jamais un repli sur l\'écriture)', f.status, 1);
    vrai('CLI : le refus nomme MONGODB_CARTES_LECTURE_URI', /MONGODB_CARTES_LECTURE_URI/.test(f.stderr + f.stdout));
    fs.writeFileSync(path.join(tmp, 'STOP'), 'arrêt demandé');
    f = fils(['--telecharger', '--plafond=5', `--dossier=${tmp}`]);
    v('CLI : STOP présent -> --telecharger ne fait RIEN, code ≠ 0', f.status !== 0 && f.status !== null, true);
    vrai('CLI : le refus nomme STOP', /STOP/.test(f.stderr));
    f = fils(['--nuit', '--a-blanc', `--dossier=${tmp}`]);
    v('CLI : STOP présent -> --nuit ne fait RIEN, code ≠ 0', f.status !== 0 && f.status !== null, true);
    vrai('CLI : --nuit nomme STOP', /STOP/.test(f.stderr));
    v('CLI : --nuit refusé n\'a écrit aucun compte rendu ni dernier-passage', fs.readdirSync(tmp).filter(x => /^nuit-|dernier-passage/.test(x)), []);
    fs.rmSync(tmp, { recursive: true });

    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
