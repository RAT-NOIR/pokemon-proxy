'use strict';
// COTES-VISUELS — le CHARGEUR : décision du testeur (2026-10-11) « visuels et cotes de Ma collection : AUCUN import dans la grappe de production ; l'API lit la base cartes en
// LECTURE SEULE et charge en mémoire ce qu'il lui faut. Au démarrage, puis une fois par jour. Si le chargement échoue, elle garde la version précédente (jamais vide) ; si elle
// n'en a aucune, elle rend cotes:{} et l'état « sans visuel » actuel. »
//   · UN chargement = lecture seule de `cartes` (v2/chargeur/lecture-seule.js) → decider (la décision partagée, règle EMBARQUÉE) → version compacte → bascule ATOMIQUE.
//   · ÉCHEC (la version en place reste, l'échec se journalise avec ses comptes) : une exception ; 0 visuel ou 0 lien sur une base non vide (§41) ; plus de 10 % d'entrées perdues.
//   · Le démarrage ne l'attend pas : demarrer() ne lit rien, diffère le premier chargement et arme un minuteur quotidien (unref). Un échec TRANSITOIRE se reprend (3 fois, toutes les 30 min) ;
//     un refus de configuration (variable absente, droits de plus que la lecture) ne se rejoue pas avant le prochain jour.
// Les messages d'erreur du pilote ne sont jamais recopiés (ils peuvent porter une adresse) : le motif est écrit ici, avec des NOMS et des comptes.
const etat = require('./etat');
const { construireVersion } = require('./version');

const JOUR_MS = 24 * 3600 * 1000;
const REPRISE_MS = 30 * 60 * 1000, REPRISES_MAX = 3;
const PERTE_MAX = 0.10;

// Ce que l'API lit dans `cartes` : TROIS collections, ces champs, rien d'autre (la liste du rapport ; le banc de lecture seule refuse toute autre collection).
const PROJECTIONS = Object.freeze({
    sets: Object.freeze({ idExpansion: 1, nomAffichage: 1, tirage: 1, region: 1, code: 1, 'bulba.expansion': 1 }),
    cartes: Object.freeze({ nomEn: 1, sets: 1, 'impressions.tirage': 1, 'impressions.expansion': 1, 'impressions.numero': 1, 'impressions.total': 1, 'impressions.rarete': 1,
        'images.set': 1, 'images.cleR2': 1, 'images.w': 1, 'images.h': 1, 'images.numero': 1, 'images.langue': 1, 'images.languePreuve': 1, 'images.source': 1,
        'images.vignette.cleR2': 1, 'images.vignette.w': 1, 'images.vignette.h': 1 }),
    cartes_produits: Object.freeze({ carteId: 1, idProduct: 1, idExpansion: 1, numeroFiche: 1, slug: 1, slugSet: 1, visuelSubstitut: 1 })
});

class Echec extends Error { constructor(motif, transitoire) { super(motif); this.motif = motif; this.transitoire = transitoire; } }
const nom = e => (e && (e.codeName || e.code || e.name)) || 'erreur';

/** La source par défaut : la lecture seule de `cartes` (ouvrir injectable). Rend { ok:true, sets, docs, lignes, fermer } ou { ok:false, raison }. */
async function sourceCartes({ env = process.env, ouvrir = require('./lecture-seule').ouvrir } = {}) {
    const o = await ouvrir({ env });
    if (!o.ok) return o;
    const c = o.cartes;
    try {
        const sets = await c.collection('sets').find({}, { projection: PROJECTIONS.sets }).toArray();
        const docs = await c.collection('cartes').find({}, { projection: PROJECTIONS.cartes }).toArray();
        const lignes = await c.collection('cartes_produits').find({}, { projection: PROJECTIONS.cartes_produits }).toArray();
        return { ok: true, sets, docs, lignes, fermer: () => c.fermer() };
    } catch (e) { try { await c.fermer(); } catch { /* déjà fermée */ } throw e; }
}
/** Le catalogue de l'API (sa propre base) : idProduct → idMetacard. */
async function catalogueApi() {
    const m = new Map();
    const curseur = require('../db').col('catalogue_produits').find({}, { projection: { idProduct: 1, idMetacard: 1 } });
    for await (const c of curseur) m.set(c.idProduct, c.idMetacard);
    return m;
}

function creerChargeur(opts = {}) {
    const source = opts.source || (() => sourceCartes({ env: opts.env || process.env }));
    const catalogue = opts.catalogue || catalogueApi;
    const regle = opts.regle || (() => require('./regle-site').regleEmbarquee());
    const decider = opts.decider || (a => require('./decision').decider(a));
    const journal = opts.journal || (m => (/^(✅|ℹ️)/.test(m) ? console.log(m) : console.error(m)));
    const T = opts.minuteurs || { setTimeout, setInterval, clearTimeout, clearInterval };
    const planifier = opts.planifier || (fn => setImmediate(fn));
    let enCours = false, jour = null, reprise = null, reprises = 0, vivant = false;

    /** @returns {Promise<{ ok: boolean, motif?: string, transitoire?: boolean, comptes?: object }>} — ne lève jamais. */
    async function charger() {
        if (enCours) return { ok: false, motif: 'un chargement est déjà en cours', transitoire: false };
        enCours = true;
        const t0 = Date.now();
        let comptes = {};
        try {
            const src = await source();
            if (!src.ok) { journal(`ℹ️ [v2 chargeur] sans chargement : ${src.raison}`); return { ok: false, motif: src.raison, transitoire: false }; }
            let r;
            try {
                const meta = await catalogue();
                r = await decider({ sets: src.sets, docs: src.docs, lignes: src.lignes, metacarte: meta, regle: await regle(), cederLaMain: true });
                comptes = { sets: src.sets.length, cartes: src.docs.length, produits: src.lignes.length, catalogue: meta.size };
            } finally { try { await src.fermer(); } catch { /* déjà fermée */ } }
            const v = construireVersion({ entrees: r.entrees, liens: r.liens });
            comptes = { ...comptes, visuels: v.comptes.visuels, refusees: v.comptes.refusees, motifs: v.comptes.motifs, setsAvecLiens: v.comptes.setsAvecLiens, fichesLiees: v.comptes.fichesLiees, produitsLies: v.comptes.produitsLies };
            const dit = `sets ${comptes.sets} · cartes ${comptes.cartes} · cartes_produits ${comptes.produits} · catalogue ${comptes.catalogue} · entrées ${v.comptes.visuels} · refusées ${v.comptes.refusees}${v.comptes.refusees ? ` (${Object.entries(v.comptes.motifs).map(([m, n]) => `${m} : ${n}`).join(' ; ')})` : ''} · fiches liées ${v.comptes.fichesLiees} (produits ${v.comptes.produitsLies}, sets ${v.comptes.setsAvecLiens})`;
            // les critères d'ÉCHEC : écrits par ce qu'ils protègent (jamais une version vide ni amputée)
            if (v.comptes.visuels === 0) throw new Echec(`0 visuel sur une base non vide — ${dit}`, false);
            if (v.comptes.fichesLiees === 0) throw new Echec(`0 lien fiche → produits sur une base non vide — ${dit}`, false);
            const prev = etat.version();
            if (prev) {
                const perdu = (a, b) => a > 0 && b < a * (1 - PERTE_MAX);
                if (perdu(prev.visuels.size, v.comptes.visuels)) throw new Echec(`perte de plus de 10 % des visuels (${prev.visuels.size} → ${v.comptes.visuels}) — ${dit}`, false);
                if (perdu(prev.comptes.fichesLiees, v.comptes.fichesLiees)) throw new Echec(`perte de plus de 10 % des fiches liées (${prev.comptes.fichesLiees} → ${v.comptes.fichesLiees}) — ${dit}`, false);
            }
            etat.installer(v);                                                       // LA bascule : un seul pointeur, la version précédente n'est plus référencée ensuite
            journal(`✅ [v2 chargeur] chargé en ${((Date.now() - t0) / 1000).toFixed(1)} s : ${dit}`);
            return { ok: true, comptes };
        } catch (e) {
            const motif = e instanceof Echec ? e.motif : `lecture impossible (${nom(e)})`;
            const transitoire = e instanceof Echec ? e.transitoire : true;
            journal(`❌ [v2 chargeur] échec, ${etat.version() ? 'version précédente gardée' : 'aucune version en place (sans visuel)'} : ${motif}${e instanceof Echec ? '' : ` — ${Object.entries(comptes).map(([k, n]) => `${k} ${typeof n === 'object' ? '…' : n}`).join(' · ') || 'aucun compte'}`}`);
            return { ok: false, motif, transitoire, comptes };
        } finally { enCours = false; }
    }

    async function tenter() {
        const r = await charger();
        if (!vivant) return r;
        if (r.ok) reprises = 0;
        else if (r.transitoire && reprises < REPRISES_MAX) { reprises++; reprise = T.setTimeout(tenter, REPRISE_MS); if (reprise && reprise.unref) reprise.unref(); }
        return r;
    }
    /** Ne lit RIEN et ne rend la main à personne : le premier chargement est différé, le minuteur est quotidien. Idempotent (un seul minuteur vivant). */
    function demarrer() {
        arreter();
        vivant = true; reprises = 0;
        planifier(() => { if (vivant) tenter(); });
        jour = T.setInterval(() => { reprises = 0; tenter(); }, JOUR_MS);
        if (jour && jour.unref) jour.unref();
    }
    function arreter() {
        vivant = false;
        if (jour) { T.clearInterval(jour); jour = null; }
        if (reprise) { T.clearTimeout(reprise); reprise = null; }
    }
    return { charger, demarrer, arreter };
}
module.exports = { creerChargeur, sourceCartes, catalogueApi, PROJECTIONS, JOUR_MS, REPRISE_MS, REPRISES_MAX, PERTE_MAX };
