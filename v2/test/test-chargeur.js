'use strict';
// COTES-VISUELS — le CHARGEUR en mémoire (ruling 3) : bascule atomique, jamais vide, échec nommé avec ses comptes, démarrage non bloquant, une fois par jour.
// Aucune base, aucune connexion : la source est INJECTÉE (des tableaux), la règle est l'embarquée, la décision est la vraie (decider).
const H = require('./_harnais');
const E = require('../chargeur/etat');
const { creerChargeur } = require('../chargeur/chargeur');
const { regleEmbarquee } = require('../chargeur/regle-site');

const SECRET = 'mot-de-passe-secret-42';
const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
const im = (set, numero, n) => ({ set, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: vig(n), langue: 'en', source: 'tcgdex' });
const imp = (numero, o = {}) => ({ tirage: 'intl', expansion: 'Set A', numero, total: '100', rarete: 'Rare', ...o });
const SETS = [{ _id: 'Set-A', idExpansion: 100, code: 'SA', nomAffichage: 'Set A', tirage: 'intl', region: 'intl', bulba: { expansion: 'Set A' } }];
// n cartes à visuel (produit 1000+i), `sans` cartes SANS visuel
function donnees(n, { sans = 0, imagesCassees = false } = {}) {
    const docs = [], lignes = [];
    for (let i = 1; i <= n + sans; i++) {
        const avec = i <= n && !imagesCassees;
        docs.push({ _id: i, nomEn: `Carte ${i}`, sets: ['Set-A'], impressions: [imp(String(i).padStart(3, '0'))], images: avec ? [im('Set-A', String(i).padStart(3, '0'), `c${i}`)] : [] });
        lignes.push({ idProduct: 1000 + i, carteId: i, idExpansion: 100, numeroFiche: String(i).padStart(3, '0'), slug: `P${i}-SA${i}`, slugSet: 'Set-A' });
    }
    return { sets: SETS, docs, lignes };
}
const catalogue = n => new Map(Array.from({ length: n }, (_, i) => [1001 + i, 5000 + i]));

(async () => {
    const regle = await regleEmbarquee();
    const journal = [];
    const fabriquer = (src, extra = {}) => creerChargeur({ source: src.source, catalogue: async () => src.catalogue ?? catalogue(100), regle: async () => regle, journal: m => journal.push(m), ...extra });
    const source = (d) => ({ source: async () => ({ ok: true, ...d, fermer: async () => { } }) });

    // ── 1. avant tout chargement : « sans visuel »
    E.vider();
    H.v('avant le premier chargement : aucune version (l\'état « sans visuel »)', E.version(), null);

    // ── 2. un chargement réussi
    const c1 = fabriquer(source(donnees(10, { sans: 2 })));
    const r1 = await c1.charger();
    H.v('chargement réussi : ok, 12 produits lus, 10 visuels, 12 fiches liées (dénominateurs imprimés)', [r1.ok, r1.comptes.produits, r1.comptes.visuels, r1.comptes.fichesLiees], [true, 12, 10, 12]);
    const v1 = E.version();
    H.v('   la version en place : 10 visuels, 1 set à liens, un produit lié à sa fiche', [v1.visuels.size, v1.liens.size, v1.liens.get('Set-A').get('1|001')], [10, 1, [1001]]);
    H.v('   le visuel d\'un produit : forme validée par lireEntree (vignette, grande, setNom)', [v1.visuels.get(1001).vignette.cle, v1.visuels.get(1001).setNom, v1.visuels.get(1001).idMetacard], ['vignettes/c1.webp', 'Set A', 5000]);
    H.v('   la métacarte retrouve ses produits', v1.parMetacarte.get(5000), [1001]);
    H.vrai('   le journal imprime les dénominateurs (documents lus, entrées, refusées)', journal.some(m => /sets 1/.test(m) && /cartes 12/.test(m) && /entrées 10/.test(m) && /refusées 0/.test(m)));
    H.vrai('   la version est GELÉE (aucune écriture accidentelle)', Object.isFrozen(v1));

    // ── 3. un échec garde la version précédente, et dit POURQUOI avec ses comptes
    journal.length = 0;
    const cEchec = fabriquer({ source: async () => { throw new Error(`panne ${SECRET}`); } });
    const rEchec = await cEchec.charger();
    H.v('source qui lève : échec transitoire, version précédente intacte', [rEchec.ok, rEchec.transitoire, E.version() === v1], [false, true, true]);
    H.vrai('   le journal nomme l\'échec et ne contient aucune valeur du message du pilote', journal.some(m => /échec/.test(m)) && !journal.join('\n').includes(SECRET));
    const cRefus = fabriquer({ source: async () => ({ ok: false, raison: 'MONGODB_CARTES_LECTURE_URI absente ou vide' }) });
    const rRefus = await cRefus.charger();
    H.v('garde de lecture seule qui refuse : échec NON transitoire (une configuration ne se rejoue pas), version intacte', [rRefus.ok, rRefus.transitoire, E.version() === v1], [false, false, true]);

    // ── 4. les trois critères d'échec
    const zero = await fabriquer(source(donnees(10, { imagesCassees: true }))).charger();
    H.v('0 visuel sur une base non vide : ÉCHEC (jamais une version vide), version précédente intacte', [zero.ok, /0 visuel/.test(zero.motif), E.version() === v1], [false, true, true]);
    const sansLien = await fabriquer(source(donnees(10)), { decider: async () => ({ entrees: [{ idProduct: 1001, visuel: 'du-set', mention: null, idMetacard: 5000, numero: '001', rarete: 'Rare', total: '100', variante: null, setNom: 'Set A', lien: null, grande: null, vignette: { cle: 'v/1.webp', w: 1, h: 1 } }], denominateurs: {}, liens: new Map() }) }).charger();
    H.v('0 lien fiche → produits sur une base non vide : ÉCHEC', [sansLien.ok, /0 lien/.test(sansLien.motif), E.version() === v1], [false, true, true]);
    const perd = await fabriquer(source(donnees(8))).charger();
    H.v('perte de plus de 10 % des entrées (10 → 8) : ÉCHEC, version précédente gardée, comptes dans le motif', [perd.ok, /10 → 8/.test(perd.motif), E.version() === v1], [false, true, true]);
    const ok9 = await fabriquer(source(donnees(9, { sans: 2 }))).charger();           // 11 fiches contre 12 : -8 %, sous la borne aussi
    H.v('perte de 10 % pile (10 → 9) : admise, la nouvelle version remplace', [ok9.ok, E.version().visuels.size], [true, 9]);
    const grandit = await fabriquer(source(donnees(30))).charger();
    H.v('un gain n\'est pas un échec (9 → 30)', [grandit.ok, E.version().visuels.size], [true, 30]);

    // ── 5. des entrées invalides sont REFUSÉES une à une (motif compté), les autres servies
    const d = donnees(5);
    d.docs[0].images[0].vignette = undefined;                                  // sans vignette : lireEntree refuse
    E.vider();
    const rInval = await fabriquer(source(d)).charger();
    H.v('une entrée sans vignette : refusée par lireEntree, comptée par motif, les 4 autres servies', [rInval.ok, rInval.comptes.refusees, rInval.comptes.motifs, E.version().visuels.size], [true, 1, { 'vignette absente': 1 }, 4]);

    // ── 6. la bascule est ATOMIQUE : pendant un chargement lent, l'ancienne version sert encore, jamais un état à moitié chargé
    let ouvrir; const porte = new Promise(r => { ouvrir = r; });
    const lent = fabriquer({ source: async () => { await porte; return { ok: true, ...donnees(40), fermer: async () => { } }; } });
    const avant = E.version();
    const enCours = lent.charger();
    await new Promise(r => setImmediate(r));
    H.v('pendant le chargement : la version en place est inchangée (même objet)', E.version() === avant, true);
    const second = await lent.charger();
    H.v('   un second chargement simultané est refusé (« en cours »), pas empilé', [second.ok, /en cours/.test(second.motif)], [false, true]);
    ouvrir(); const fini = await enCours;
    H.v('après : la version est ENTIÈRE (40 visuels), d\'un seul geste', [fini.ok, E.version().visuels.size, E.version() !== avant, fini.motif], [true, 40, true, undefined]);

    // ── 7. le démarrage ne l'attend pas ; une fois par jour ; arrêt
    E.vider();
    const minuteurs = []; const faux = { setTimeout: (fn, ms) => { const t = { fn, ms, kind: 'timeout', cleared: false, unref() { return this; } }; minuteurs.push(t); return t; },
        setInterval: (fn, ms) => { const t = { fn, ms, kind: 'interval', cleared: false, unref() { return this; } }; minuteurs.push(t); return t; }, clearTimeout: t => { t.cleared = true; }, clearInterval: t => { t.cleared = true; } };
    let appels = 0; const immediats = [];
    const nonBloquant = fabriquer({ source: async () => { appels++; return new Promise(() => { }); } }, { minuteurs: faux, planifier: fn => immediats.push(fn) });
    const t0 = process.hrtime.bigint(); nonBloquant.demarrer(); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    H.v('demarrer() rend la main sans rien lire (source jamais interrogée, chargement différé)', [appels, immediats.length], [0, 1]);
    H.vrai(`   ... en moins de 50 ms (${ms.toFixed(2)} ms) même si la source ne répond JAMAIS`, ms < 50);
    H.v('   un minuteur QUOTIDIEN (24 h), unref', [minuteurs.filter(m => m.kind === 'interval').map(m => m.ms)], [[24 * 3600 * 1000]]);
    immediats[0](); await new Promise(r => setImmediate(r));
    H.v('   le premier chargement part après coup (source interrogée une fois)', appels, 1);
    nonBloquant.arreter();
    H.v('   arreter() annule les minuteurs', minuteurs.filter(m => !m.cleared).length, 0);
    nonBloquant.demarrer(); nonBloquant.demarrer();
    H.v('   deux demarrer() : UN seul minuteur quotidien vivant', minuteurs.filter(m => m.kind === 'interval' && !m.cleared).length, 1);
    nonBloquant.arreter();

    // reprise après un échec transitoire : 3 reprises au plus, jamais pour un refus de configuration
    const m2 = []; const faux2 = { ...faux, setTimeout: (fn, ms) => { const t = { fn, ms, kind: 'timeout', cleared: false, unref() { return this; } }; m2.push(t); return t; }, setInterval: () => ({ unref() { } }) };
    const reprise = fabriquer({ source: async () => { throw new Error('x'); } }, { minuteurs: faux2, planifier: fn => fn() });
    reprise.demarrer(); await new Promise(r => setTimeout(r, 30));
    H.v('échec transitoire au démarrage : une reprise planifiée à 30 min', m2.map(t => t.ms), [30 * 60 * 1000]);
    let total = m2.length;
    while (m2.length) { const t = m2.shift(); t.fn(); await new Promise(r => setTimeout(r, 30)); total += m2.length; }
    H.v('   trois reprises AU PLUS, puis on attend le prochain chargement quotidien', total, 3);
    reprise.arreter();
    const m3 = []; const faux3 = { ...faux, setTimeout: (fn, ms) => { m3.push(ms); return { unref() { return this; } }; }, setInterval: () => ({ unref() { } }) };
    const refus = fabriquer({ source: async () => ({ ok: false, raison: 'MONGODB_CARTES_LECTURE_URI absente ou vide' }) }, { minuteurs: faux3, planifier: fn => fn() });
    refus.demarrer(); await new Promise(r => setTimeout(r, 30));
    H.v('refus de configuration au démarrage : AUCUNE reprise (on ne martèle pas Atlas avec une variable absente)', m3, []);
    refus.arreter();

    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
