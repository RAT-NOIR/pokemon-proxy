'use strict';
// COTES-VISUELS — le CHARGEUR en mémoire (rulings 3 et tour 1) : bascule atomique, jamais vide, échec nommé avec ses comptes, démarrage non bloquant, une fois par jour, AUCUNE reprise en boucle,
// calcul dans un FIL plafonné dont la mort ne touche pas le serveur. La source est INJECTÉE (des tableaux) ou un fil de banc ; la règle est l'embarquée, la décision est la vraie.
const path = require('path');
const { Worker } = require('worker_threads');
const H = require('./_harnais');
const E = require('../chargeur/etat');
const { creerChargeur, executerDansUnFil, LIMITES_FIL } = require('../chargeur/chargeur');
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
const SETTIMEOUT = global.setTimeout;                                           // le vrai : l'attente du banc ne se compte pas parmi les minuteries du chargeur
const attendre = ms => new Promise(r => SETTIMEOUT(r, ms));

(async () => {
    const journal = [];
    const fabriquer = (src, extra = {}) => creerChargeur({ source: src.source, catalogue: async () => src.catalogue ?? catalogue(100), journal: m => journal.push(m), pret: async () => true, ...extra });
    const source = d => ({ source: async () => ({ ok: true, ...d, fermer: async () => { } }) });

    // ── 1. avant tout chargement : « sans visuel »
    E.vider();
    H.v('avant le premier chargement : aucune version (l\'état « sans visuel »)', E.version(), null);

    // ── 2. un chargement réussi
    const c1 = fabriquer(source(donnees(10, { sans: 2 })));
    const r1 = await c1.charger();
    H.v('chargement réussi : ok, 12 produits lus, 10 visuels, 12 fiches liées (dénominateurs imprimés)', [r1.ok, r1.comptes.produits, r1.comptes.visuels, r1.comptes.fichesLiees], [true, 12, 10, 12]);
    const v1 = E.version();
    H.v('   la version en place : 10 visuels, 1 set à liens, un produit lié à sa fiche', [v1.comptes.visuels, v1.comptes.setsAvecLiens, v1.produitsDeLaFiche('Set-A', '1|001')], [10, 1, [1001]]);
    H.v('   le visuel d\'un produit : forme validée par lireEntree (vignette, grande, setNom)', [v1.entree(1001).vignette.cle, v1.entree(1001).setNom, v1.entree(1001).idMetacard], ['vignettes/c1.webp', 'Set A', 5000]);
    H.v('   la métacarte retrouve ses produits', v1.produitsDeMetacarte(5000), [1001]);
    H.vrai('   le journal imprime les dénominateurs (documents lus, entrées, refusées)', journal.some(m => /sets 1/.test(m) && /cartes 12/.test(m) && /entrées 10/.test(m) && /refusées 0/.test(m)));
    H.vrai('   la version est GELÉE (aucune écriture accidentelle)', Object.isFrozen(v1));

    // ── 3. un échec garde la version précédente, et dit POURQUOI
    journal.length = 0;
    const rEchec = await fabriquer({ source: async () => { throw new Error(`panne ${SECRET}`); } }).charger();
    H.v('source qui lève : échec, version précédente intacte', [rEchec.ok, E.version() === v1], [false, true]);
    H.vrai('   le journal nomme l\'échec, dit « prochain essai au rechargement quotidien », et ne contient aucune valeur du message du pilote', journal.some(m => /échec/.test(m) && /rechargement quotidien/.test(m)) && !journal.join('\n').includes(SECRET));
    const rRefus = await fabriquer({ source: async () => ({ ok: false, raison: 'MONGODB_CARTES_LECTURE_URI absente ou vide' }) }).charger();
    H.v('garde de lecture seule qui refuse : pas de chargement, version intacte', [rRefus.ok, E.version() === v1], [false, true]);

    // ── 4. les critères d'échec
    const zero = await fabriquer(source(donnees(10, { imagesCassees: true }))).charger();
    H.v('0 visuel sur une base non vide : ÉCHEC (jamais une version vide), version précédente intacte', [zero.ok, /0 visuel/.test(zero.motif), E.version() === v1], [false, true, true]);
    const sansLien = await fabriquer(source(donnees(10)), { decider: async ({ sink }) => { sink.entree({ idProduct: 1001, visuel: 'du-set', mention: null, idMetacard: 5000, numero: '001', rarete: 'Rare', total: '100', variante: null, setNom: 'Set A', lien: null, grande: null, vignette: { cle: 'v/1.webp', w: 1, h: 1 } }); return { denominateurs: { setsAvecLiens: 0, produitsLies: 0 } }; } }).charger();
    H.v('0 lien fiche → produits sur une base non vide : ÉCHEC', [sansLien.ok, /0 lien/.test(sansLien.motif), E.version() === v1], [false, true, true]);
    const perd = await fabriquer(source(donnees(8))).charger();
    H.v('perte de plus de 10 % des entrées (10 → 8) : ÉCHEC, version précédente gardée, comptes dans le motif', [perd.ok, /10 → 8/.test(perd.motif), E.version() === v1], [false, true, true]);
    const ok9 = await fabriquer(source(donnees(9, { sans: 2 }))).charger();           // 11 fiches contre 12 : -8 %, sous la borne aussi
    H.v('perte de 10 % pile (10 → 9) : admise, la nouvelle version remplace', [ok9.ok, E.version().comptes.visuels], [true, 9]);
    const grandit = await fabriquer(source(donnees(30))).charger();
    H.v('un gain n\'est pas un échec (9 → 30)', [grandit.ok, E.version().comptes.visuels], [true, 30]);
    // JUMEAU-V2 : la colonne des jumeaux vient du VRAI decider (tous les produits du catalogue, 100 ici) ; une version sans colonne ne remplace jamais une version qui l'a
    const vCol = E.version();
    H.v('JUMEAU-V2 : la version chargée porte la colonne des jumeaux (100 produits du catalogue, dont ceux sans ligne)', [vCol.colonneJumeaux, vCol.comptes.jumeaux, vCol.jumeauxDe(1001), vCol.jumeauxDe(1100)], [true, 100, [], []]);
    const sansColonne = await fabriquer(source(donnees(30)), { decider: a => require('../chargeur/decision').decider({ ...a, sink: { entree: a.sink.entree, lien: a.sink.lien } }) }).charger();
    H.v('   une version SANS colonne ne remplace pas une version qui l\'a : ÉCHEC nommé, version en place gardée', [sansColonne.ok, /colonne des jumeaux/.test(sansColonne.motif || ''), E.version() === vCol], [false, true, true]);

    // ── 5. des entrées invalides sont REFUSÉES une à une (motif compté), les autres servies
    const d = donnees(5);
    d.docs[0].images[0].vignette = undefined;                                  // sans vignette : lireEntree refuse
    E.vider();
    const rInval = await fabriquer(source(d)).charger();
    H.v('une entrée sans vignette : refusée par lireEntree, comptée par motif, les 4 autres servies', [rInval.ok, rInval.comptes.refusees, rInval.comptes.motifs, E.version().comptes.visuels], [true, 1, { 'vignette absente': 1 }, 4]);

    // ── 6. la bascule est ATOMIQUE : pendant un chargement lent, l'ancienne version sert encore, jamais un état à moitié chargé
    let ouvrir; const porte = new Promise(r => { ouvrir = r; });
    let appelsSource = 0;
    const lent = fabriquer({ source: async () => { appelsSource++; await porte; return { ok: true, ...donnees(40), fermer: async () => { } }; } });
    const avant = E.version();
    const enCours = lent.charger();
    await new Promise(r => setImmediate(r));
    H.v('pendant le chargement : la version en place est inchangée (même objet)', E.version() === avant, true);
    const second = await Promise.race([lent.charger(), attendre(300).then(() => ({ ok: 'BLOQUÉ : le second chargement est parti et attend la porte' }))]);      // C4 : s'il était admis, il se bloquerait ici
    H.v('   un second chargement simultané est refusé (« en cours »), pas empilé : la source n\'a été interrogée qu\'UNE fois', [second.ok, /en cours/.test(second.motif), appelsSource], [false, true, 1]);
    ouvrir(); const fini = await enCours;
    H.v('après : la version est ENTIÈRE (40 visuels), d\'un seul geste', [fini.ok, E.version().comptes.visuels, E.version() !== avant, fini.motif], [true, 40, true, undefined]);

    // ── 7. le démarrage ne l'attend pas ; une fois par jour ; arrêt
    E.vider();
    const minuteurs = []; const faux = { setInterval: (fn, ms) => { const t = { fn, ms, cleared: false, unref() { return this; } }; minuteurs.push(t); return t; }, clearInterval: t => { t.cleared = true; } };
    let appels = 0; const immediats = [];
    const nonBloquant = fabriquer({ source: async () => { appels++; return new Promise(() => { }); } }, { minuteurs: faux, planifier: fn => immediats.push(fn) });
    const t0 = process.hrtime.bigint(); nonBloquant.demarrer(); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    H.v('demarrer() rend la main sans rien lire (source jamais interrogée, chargement différé)', [appels, immediats.length], [0, 1]);
    H.vrai(`   ... en moins de 50 ms (${ms.toFixed(2)} ms) même si la source ne répond JAMAIS`, ms < 50);
    H.v('   un minuteur QUOTIDIEN (24 h), unref', minuteurs.map(m => m.ms), [24 * 3600 * 1000]);
    immediats[0](); await attendre(20);
    H.v('   le premier chargement part après coup (source interrogée une fois)', appels, 1);
    nonBloquant.arreter();
    H.v('   arreter() annule le minuteur', minuteurs.filter(m => !m.cleared).length, 0);
    nonBloquant.demarrer(); nonBloquant.demarrer();
    H.v('   deux demarrer() : UN seul minuteur quotidien vivant', minuteurs.filter(m => !m.cleared).length, 1);
    nonBloquant.arreter();

    // ── 8. AUCUNE REPRISE EN BOUCLE (règle du testeur) : un échec — exception, refus, base pas prête — n'arme AUCUN minuteur ; le prochain essai est le tick quotidien
    const armes = []; const T2 = { setInterval: (fn, ms) => { const t = { fn, ms, unref() { return this; } }; armes.push(['interval', ms]); minuteurs.push(t); return t; }, clearInterval() { } };
    const vraiSetTimeout = global.setTimeout; let timeoutsPoses = 0; global.setTimeout = (...a) => { timeoutsPoses++; return vraiSetTimeout(...a); };
    let essais = 0; const echoue = fabriquer({ source: async () => { essais++; throw new Error('x'); } }, { minuteurs: T2, planifier: fn => fn() });
    minuteurs.length = 0; echoue.demarrer(); await attendre(40);
    const apres1 = [essais, armes.length, timeoutsPoses];
    await attendre(250);
    const apres2 = [essais, armes.length, timeoutsPoses];
    H.v('échec au démarrage : UN essai, UN seul minuteur armé (le quotidien), aucune minuterie de reprise', [apres1[0], apres1[1]], [1, 1]);
    H.v('   250 ms plus tard : toujours 1 essai (aucune boucle ne s\'est mise en route), AUCUN setTimeout posé par le chargeur', [apres2[0], timeoutsPoses], [1, 0]);
    minuteurs[0].fn(); await attendre(40);
    H.v('   le tick quotidien suivant fait UN nouvel essai (et un seul)', essais, 2);
    echoue.arreter();
    const refus = fabriquer({ source: async () => { essais++; return { ok: false, raison: 'MONGODB_CARTES_LECTURE_URI absente ou vide' }; } }, { minuteurs: T2, planifier: fn => fn() });
    essais = 0; refus.demarrer(); await attendre(250);
    H.v('refus de configuration : UN essai, aucune reprise', essais, 1);
    refus.arreter();
    let appelsPret = 0; essais = 0;
    const basePasPrete = fabriquer({ source: async () => { essais++; return { ok: true, ...donnees(3), fermer: async () => { } }; } }, { minuteurs: T2, planifier: fn => fn(), pret: async () => { appelsPret++; return false; } });
    basePasPrete.demarrer(); await attendre(250);
    H.v('base de l\'API jamais prête : aucun chargement, une seule attente, aucune reprise', [essais, appelsPret], [0, 1]);
    basePasPrete.arreter();
    global.setTimeout = vraiSetTimeout;

    // ── 8 bis. (passe 2, I2) LA SEULE EXCEPTION à « aucune reprise » : tant que la colonne des jumeaux MANQUE (aucune version, ou une version d'avant la colonne), la route réessaie toutes les 5 minutes
    //    au lieu d'attendre le réveil suivant — sans elle, toute affirmation est un 503 jusque-là. Horloge INJECTÉE : aucune attente réelle. Dès que la colonne est là, plus aucune reprise.
    {
        E.vider();
        const posees = []; let horloge = 1_000_000;
        const T3 = { setInterval: (fn, ms) => ({ fn, ms, unref() { return this; } }), clearInterval() { },
            setTimeout: (fn, ms) => { const t = { fn, ms, annule: false, unref() { return this; } }; posees.push(t); return t; }, clearTimeout: t => { t.annule = true; } };
        let tentatives = 0;
        const flaky = fabriquer({ source: async () => { tentatives++; if (tentatives < 3) throw new Error('R2 muet'); return { ok: true, ...donnees(10), fermer: async () => { } }; } }, { minuteurs: T3, planifier: fn => fn(), maintenant: () => horloge });
        flaky.demarrer(); await attendre(60);
        H.v('JUMEAU-V2 reprise : un échec au démarrage sans colonne en place arme UNE reprise à 5 min (300 000 ms), unref', [tentatives, posees.length, posees[0] && posees[0].ms], [1, 1, 300000]);
        posees[0].fn(); await attendre(60);
        H.v('   la reprise fait UN nouvel essai ; il échoue encore : une autre reprise est armée', [tentatives, posees.length, posees[1] && posees[1].ms], [2, 2, 300000]);
        posees[1].fn(); await attendre(60);
        H.v('   3e essai : la version avec colonne s\'installe ; plus AUCUNE reprise armée', [tentatives, E.version() && E.version().colonneJumeaux, posees.length], [3, true, 2]);
        flaky.arreter();
        // une version d'avant la colonne en place : la reprise tourne aussi (le chargement suivant peut apporter la colonne)
        E.vider();
        const { creerConstructeur } = require('../chargeur/version');
        const ancienne = (() => { const b = creerConstructeur(); b.entree({ idProduct: 1, vignette: { cle: 'v/1.webp', w: 1, h: 1 }, grande: null, visuel: 'du-set', mention: null, idMetacard: null, numero: null, rarete: null, total: null, variante: null, setNom: null, lien: null }); return b.finir(); })();
        E.installer(ancienne);
        posees.length = 0;
        const sansCol = fabriquer({ source: async () => { throw new Error('x'); } }, { minuteurs: T3, planifier: fn => fn(), maintenant: () => horloge });
        sansCol.demarrer(); await attendre(60);
        H.v('   une version SANS colonne en place + un échec : reprise armée ; arreter() l\'annule', [posees.length, (sansCol.arreter(), posees[0].annule)], [1, true]);
        // la colonne est là : un échec ultérieur n'arme rien (la règle « aucun nouvel essai » reprend)
        E.vider(); await fabriquer(source(donnees(10))).charger();
        posees.length = 0;
        const avecCol = fabriquer({ source: async () => { throw new Error('x'); } }, { minuteurs: T3, planifier: fn => fn(), maintenant: () => horloge });
        avecCol.demarrer(); await attendre(60);
        H.v('   la colonne est en place : un échec ne pose AUCUNE reprise', posees.length, 0);
        avecCol.arreter();

        // ── (passe 2, I3) l'alerte « archive trop ancienne » : écrite en base (comme alerte/file-vide), jamais seulement un journal
        const docs = []; const alerte = async d => { docs.push(d); };
        E.vider();
        const surveille = fabriquer(source(donnees(10)), { minuteurs: T3, planifier: fn => fn(), maintenant: () => horloge, alerte });
        await fabriquer({ source: async () => { throw new Error('x'); } }, { minuteurs: T3, planifier: fn => fn(), maintenant: () => horloge, alerte }).charger();   // charger() seul n'écrit rien : c'est le cycle qui surveille
        H.v('JUMEAU-V2 alerte : charger() seul n\'écrit rien (le cycle d\'essai surveille)', docs.length, 0);
        const aucune = fabriquer({ source: async () => { throw new Error('x'); } }, { minuteurs: T3, planifier: fn => fn(), maintenant: () => horloge, alerte });
        aucune.demarrer(); await attendre(60); aucune.arreter();
        H.v('   aucune archive en mémoire après l\'essai : alerte ACTIVE, raison sans-archive', [docs.at(-1).actif, docs.at(-1).raison], [true, 'sans-archive']);
        surveille.demarrer(); await attendre(60);
        const frais = docs.at(-1);
        H.v('   archive fraîche avec colonne : alerte RÉSOLUE (actif faux)', [frais.actif, frais.raison], [false, null]);
        horloge = Date.now() + 49 * 3600 * 1000;
        const tardif = fabriquer({ source: async () => { throw new Error('x'); } }, { minuteurs: T3, planifier: fn => fn(), maintenant: () => horloge, alerte });
        tardif.demarrer(); await attendre(60); tardif.arreter();
        H.v('   la même archive à 49 h (l\'essai échoue, elle reste en place) : alerte ACTIVE, raison ancienne, âge 49 h', [docs.at(-1).actif, docs.at(-1).raison, docs.at(-1).ageHeures], [true, 'ancienne', 49]);
        horloge = Date.now() + 47 * 3600 * 1000;
        const limite = fabriquer({ source: async () => { throw new Error('x'); } }, { minuteurs: T3, planifier: fn => fn(), maintenant: () => horloge, alerte });
        limite.demarrer(); await attendre(60); limite.arreter();
        H.v('   à 47 h : pas d\'alerte (le seuil est 48 h)', docs.at(-1).actif, false);
        E.vider(); E.installer(ancienne); horloge = Date.now();
        const sansColonneAlerte = fabriquer({ source: async () => { throw new Error('x'); } }, { minuteurs: T3, planifier: fn => fn(), maintenant: () => horloge, alerte });
        sansColonneAlerte.demarrer(); await attendre(60); sansColonneAlerte.arreter();
        H.v('   une archive SANS colonne (récente) : alerte ACTIVE, raison sans-colonne', [docs.at(-1).actif, docs.at(-1).raison], [true, 'sans-colonne']);
        const casse = fabriquer(source(donnees(10)), { minuteurs: T3, planifier: fn => fn(), maintenant: () => horloge, alerte: async () => { throw new Error('base muette'); } });
        const j0 = journal.length; E.vider(); casse.demarrer(); await attendre(60); casse.arreter();
        H.vrai('   une alerte qui ne s\'écrit pas ne casse JAMAIS le chargement (version installée) et se DIT au journal', E.version() && journal.slice(j0).some(m => /alerte/.test(m)));
        // l'écriture elle-même (collection de l'API) : le début d'un épisode se garde, la résolution est datée, un nouvel épisode repart de son propre début
        const { ecrireAlerteArchive } = require('../chargeur/alerte-archive');
        const memoire = new Map();
        const col = { findOne: async f => memoire.get(f._id) || null, updateOne: async (f, m) => { memoire.set(f._id, { ...(memoire.get(f._id) || { _id: f._id }), ...m.$set }); } };
        const t = h => new Date(`2026-10-12T${h}:00Z`);
        await ecrireAlerteArchive(col, { actif: true, raison: 'ancienne', ageHeures: 49, chargeLe: t('01:00'), maintenant: t('10:00') });
        await ecrireAlerteArchive(col, { actif: true, raison: 'ancienne', ageHeures: 52, chargeLe: t('01:00'), maintenant: t('13:00') });
        const a = memoire.get('alerte/archive-visuels');
        H.v('   alerte écrite : un épisode qui dure garde son début, son âge se met à jour', [a.active, a.depuis.toISOString(), a.constateLe.toISOString(), a.ageHeures, a.raison], [true, t('10:00').toISOString(), t('13:00').toISOString(), 52, 'ancienne']);
        await ecrireAlerteArchive(col, { actif: false, maintenant: t('20:00') });
        H.v('   résolue : inactive, résolution datée', [memoire.get('alerte/archive-visuels').active, memoire.get('alerte/archive-visuels').resolueLe.toISOString()], [false, t('20:00').toISOString()]);
        await ecrireAlerteArchive(col, { actif: true, raison: 'sans-colonne', ageHeures: 1, chargeLe: t('19:00'), maintenant: t('22:00') });
        H.v('   un NOUVEL épisode repart de son propre début', memoire.get('alerte/archive-visuels').depuis.toISOString(), t('22:00').toISOString());
    }

    // ── 9. le FIL plafonné : sa mort ne touche pas le serveur ; le résultat revient en tampons transférés
    const ENV = { MONGODB_CARTES_LECTURE_URI: `mongodb+srv://lecteur:${SECRET}@h.exemple.net/cartes`, MONGODB_CARTES_URI: `mongodb+srv://ecrivain:${SECRET}@h.exemple.net/cartes` };
    const filDeBanc = (mode, limites) => (don, lim) => new Worker(path.join(__dirname, 'fil-test.js'), { workerData: { ...don, env: { ...don.env, MODE_BANC: mode } }, resourceLimits: limites || lim, transferList: [don.ids.buffer, don.metas.buffer] });
    const surFil = (mode, extra = {}, limites) => executerDansUnFil({ env: ENV, creerFil: filDeBanc(mode, limites), ...extra });
    E.vider();
    journal.length = 0;
    const chFil = creerChargeur({ executer: surFil('reussite'), catalogue: async () => catalogue(100), journal: m => journal.push(m), pret: async () => true });
    const rFil = await chFil.charger();
    H.v('fil de banc : le résultat revient (5 visuels, 1 fiche liée), version installée', [rFil.ok, E.version() && E.version().comptes.visuels, E.version() && E.version().produitsDeLaFiche('Set-F', '1|001')], [true, 5, [101, 102]]);
    H.v('   la version reçue d\'un autre fil se lit (tampons transférés, aucune copie) : entree(103)', E.version().entree(103), { idProduct: 103, vignette: { cle: 'v/103.webp', w: 2, h: 3 }, grande: null, mention: null, idMetacard: 70, numero: '001', rarete: 'Rare', total: '10', variante: null, setNom: 'Set Fil', lien: null,
        partageeHoloNonHolo: null, partageeTamponNonSepare: null, produitsPartages: null, tamponNonRepresente: null, basseDefinition: null, prixMelangeTampon: null });       // REPLI-REIMPRESSIONS : les cinq marquages, nuls pour une image ordinaire ; LOT TAMPONS : + `prixMelangeTampon` (inconnu = null)
    const garde = E.version();
    const rOOM = await creerChargeur({ executer: surFil('gourmand', {}, { maxOldGenerationSizeMb: 24, maxYoungGenerationSizeMb: 8 }), catalogue: async () => catalogue(100), journal: m => journal.push(m), pret: async () => true }).charger();
    H.v('fil qui dépasse son plafond de tas : TUÉ (le serveur vit : ce banc continue), échec nommé, version précédente gardée', [rOOM.ok, /fil tué : dépassement de mémoire/.test(rOOM.motif), E.version() === garde], [false, true, true]);
    const rRefusFil = await creerChargeur({ executer: surFil('refus'), catalogue: async () => catalogue(100), journal: m => journal.push(m), pret: async () => true }).charger();
    H.v('fil dont la garde de lecture seule refuse : échec, version gardée', [rRefusFil.ok, /MONGODB_CARTES_LECTURE_URI/.test(rRefusFil.motif), E.version() === garde], [false, true, true]);
    const rMuet = await creerChargeur({ executer: surFil('muet', { delaiMs: 200 }), catalogue: async () => catalogue(100), journal: m => journal.push(m), pret: async () => true }).charger();
    H.v('fil muet : arrêté au délai, échec nommé, version gardée', [rMuet.ok, /délai/.test(rMuet.motif), E.version() === garde], [false, true, true]);
    let crees = 0;
    const sansVariable = await executerDansUnFil({ env: {}, creerFil: () => { crees++; throw new Error('ne doit pas être créé'); } })({ catalogue: catalogue(3) });
    H.v('variable de lecture absente : refus AVANT de lancer un fil (aucun fil créé)', [sansVariable.ok, crees], [false, 0]);
    const memeUri = await executerDansUnFil({ env: { MONGODB_CARTES_LECTURE_URI: ENV.MONGODB_CARTES_URI, MONGODB_CARTES_URI: ENV.MONGODB_CARTES_URI }, creerFil: () => { crees++; throw new Error('non'); } })({ catalogue: catalogue(3) });
    H.v('variable de lecture = écriture : refus AVANT de lancer un fil', [memeUri.ok, crees], [false, 0]);
    H.vrai('   aucun journal ne contient de valeur d\'URI', !journal.join('\n').includes(SECRET));
    // M3 : le mot de passe de l'URI d'ÉCRITURE ne voyage pas jusqu'au fil
    let vue = null;
    const veilleFil = setTimeout(() => { }, 2000);                  // le délai du fil est « unref » : sans veille, le banc sortirait avant son échéance
    await executerDansUnFil({ env: ENV, creerFil: (don) => { vue = JSON.stringify(don.env); return { on() { }, terminate() { } }; }, delaiMs: 20 })({ catalogue: catalogue(3) });
    clearTimeout(veilleFil);
    H.v('le fil reçoit l\'URI d\'écriture SANS mot de passe (l\'utilisateur reste pour la comparaison), la lecture telle quelle', [vue.includes(SECRET + '@') && vue.includes('ecrivain:'), vue.includes('ecrivain@h.exemple.net'), vue.includes('lecteur:' + SECRET)], [false, true, true]);
    // C6 (équivalent, une ligne) : etat.installer refuse une version non gelée ; la version produite par assembler() est TOUJOURS gelée, donc le chemin « non gelée » n'est pas atteignable par le chargeur
    let nonGelee = null; try { E.installer({ comptes: {} }); } catch (e) { nonGelee = e.message; }
    H.vrai('etat.installer refuse une version non gelée', typeof nonGelee === 'string');
    H.v('plafonds du fil écrits : tas ≤ 192 Mo, jeune ≤ 24 Mo', [LIMITES_FIL.maxOldGenerationSizeMb, LIMITES_FIL.maxYoungGenerationSizeMb], [192, 24]);

    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
