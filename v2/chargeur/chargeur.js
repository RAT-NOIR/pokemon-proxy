'use strict';
// COTES-VISUELS — le CHARGEUR : décision du testeur (2026-10-11) « visuels et cotes de Ma collection : AUCUN import dans la grappe de production ; l'API charge en mémoire ce qu'il lui faut.
// Si le chargement échoue, elle garde la version précédente (jamais vide) ; si elle n'en a aucune, elle rend cotes:{} et l'état « sans visuel ». »
//   · UN chargement = calcul (dans un FIL DE TRAVAIL plafonné : lecture seule de `cartes` en flux → decider → colonnes) OU lecture d'un fichier précalculé (même format) → bascule ATOMIQUE.
//   · Le fil est plafonné (`resourceLimits`) : un dépassement tue le FIL, jamais le serveur ; le résultat revient en tampons transférables (aucune copie). La boucle du serveur n'est jamais occupée.
//   · ÉCHEC (la version en place reste servie, l'échec se journalise avec ses comptes) : une exception, un fil tué, 0 visuel, 0 lien (§41), plus de 10 % d'entrées perdues.
//   · RÈGLE DE REPRISE (testeur, 2026-10-11) : AUCUN nouvel essai après un échec. Le prochain essai est le rechargement quotidien suivant. Aucune minuterie de reprise n'existe dans ce fichier.
//   · Le démarrage ne l'attend jamais : demarrer() ne lit rien ; le premier chargement est différé et attend que la base de l'API soit prête (attente bornée, pas un essai).
// Les messages d'erreur du pilote ne sont jamais recopiés (ils peuvent porter une adresse) : le motif est écrit ici, avec des NOMS et des comptes.
const path = require('path');
const etat = require('./etat');
const { depuisPaquet } = require('./version');
const { calculer } = require('./calcul');
const { sourceCartes, PROJECTIONS } = require('./source');

const JOUR_MS = 24 * 3600 * 1000;
const PERTE_MAX = 0.10;
const FIL = path.join(__dirname, 'fil.js');
// plafonds du fil : un dépassement tue LE FIL (ERR_WORKER_OUT_OF_MEMORY), jamais le processus principal
const LIMITES_FIL = Object.freeze({ maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 24, codeRangeSizeMb: 16, stackSizeMb: 4 });
const DELAI_FIL_MS = 30 * 60 * 1000;
const ATTENTE_BASE_MS = 10 * 60 * 1000;

class Echec extends Error { constructor(motif) { super(motif); this.motif = motif; } }
const nom = e => (e && (e.codeName || e.code || e.name)) || 'erreur';

/** Le calcul EN LIGNE (les bancs, la mesure sans fil) : même `calculer` que dans le fil. @returns {Promise<{ok, version, comptes} | {ok:false, raison}>} */
function executerEnLigne({ source, regle = () => require('./regle-site').regleEmbarquee(), decider }) {
    return async ({ catalogue }) => {
        const src = await source();
        if (!src.ok) return { ok: false, raison: src.raison };
        try { const r = await calculer({ sets: src.sets, docs: src.docs, lignes: src.lignes, metacarte: catalogue, regle: await regle(), decider }); return { ok: true, version: r.version, comptes: r.comptes }; }
        finally { try { await src.fermer(); } catch { /* déjà fermée */ } }
    };
}

/** Le calcul dans un FIL PLAFONNÉ. `creerFil(donnees, limites)` est injectable (le banc passe un fil de test, ou un faux). */
function executerDansUnFil({ env = process.env, limites = LIMITES_FIL, delaiMs = DELAI_FIL_MS, creerFil = null, fichierFil = FIL } = {}) {
    return async ({ catalogue }) => {
        const j = require('./lecture-seule').jugerVariables(env);                       // le refus de configuration se juge ICI, avant de lancer un fil
        if (!j.ok) return { ok: false, raison: j.raison };
        const ids = new Int32Array(catalogue.size), metas = new Int32Array(catalogue.size);
        let i = 0; for (const [a, b] of catalogue) { ids[i] = a; metas[i] = Number.isInteger(b) ? b : -1; i++; }
        // seules les DEUX variables de lecture passent au fil, explicitement : ce que dotenv ajouterait à l'environnement du fil ne compte pas
        // (le mot de passe de l'URI d'ÉCRITURE ne voyage pas : la comparaison à la variable de lecture n'a besoin que de l'adresse et de l'utilisateur)
        const donnees = { env: { MONGODB_CARTES_LECTURE_URI: env.MONGODB_CARTES_LECTURE_URI, MONGODB_CARTES_URI: require('./lecture-seule').sansMotDePasse(env.MONGODB_CARTES_URI) }, ids, metas };
        const { Worker } = require('worker_threads');
        const w = creerFil ? creerFil(donnees, limites) : new Worker(fichierFil, { workerData: donnees, resourceLimits: limites, transferList: [ids.buffer, metas.buffer] });
        return new Promise(resolve => {
            let fini = false;
            const clore = r => { if (fini) return; fini = true; clearTimeout(minuteur); try { w.terminate(); } catch { /* déjà terminé */ } resolve(r); };
            const minuteur = setTimeout(() => clore({ ok: false, raison: `fil arrêté : délai de ${Math.round(delaiMs / 60000)} min dépassé` }), delaiMs);
            if (minuteur.unref) minuteur.unref();
            w.on('message', m => {
                if (!m || typeof m !== 'object') return clore({ ok: false, raison: 'fil : message illisible' });
                if (m.type === 'refus') return clore({ ok: false, raison: String(m.raison).slice(0, 300) });
                if (m.type === 'erreur') return clore({ ok: false, raison: `fil en erreur (${String(m.nom).slice(0, 40)})` });
                if (m.type !== 'resultat') return clore({ ok: false, raison: 'fil : message inconnu' });
                try { clore({ ok: true, version: m.donnees ? depuisPaquet(m.donnees) : null, comptes: m.comptes }); } catch (e) { clore({ ok: false, raison: `fil : résultat illisible (${nom(e)})` }); }
            });
            w.on('error', e => clore({ ok: false, raison: e && e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? `fil tué : dépassement de mémoire (plafond ${limites.maxOldGenerationSizeMb} Mo de tas)` : `fil en erreur (${nom(e)})` }));
            w.on('exit', code => clore({ ok: false, raison: `fil terminé sans résultat (code ${code})` }));
        });
    };
}

/** La voie « fichier précalculé » : `lireFichier()` rend l'archive (gzip) ; la structure est jugée par format.js. Aucun calcul, aucune lecture de `cartes`. */
function executerDepuisFichier({ lireFichier, secret, nonScelleBanc = false }) {
    // FERMÉE par défaut : sans secret HMAC, aucune archive n'est ouverte. Seul un banc déclare explicitement `nonScelleBanc` (archive locale sans scellement).
    if (!nonScelleBanc && !require('./scellement').secretValide(secret)) return async () => ({ ok: false, raison: 'secret HMAC (V2_VISUELS_HMAC) absent ou trop court : aucune archive n\'est ouverte' });
    return async () => {
        const F = require('./format'); const { rejugerEntreesParPaquets } = require('./version');
        let v, ent;
        try {
            const lu = await lireFichier();
            const gz = nonScelleBanc ? lu : require('./scellement').ouvrir(lu, secret);          // taille, magie et HMAC AVANT toute décompression
            const plein = await F.decompresser(gz);                                              // 16 Mo compressés / 48 Mo décompressés au plus
            v = F.deserialiser(plein); ent = F.lireEntete(plein).entree || {};
            const rejuge = await rejugerEntreesParPaquets(v);                                    // lireEntree sur CHAQUE entrée chargée (ruling 4), la main rendue à la boucle tous les 4 000 : l'archive entière est refusée au premier rejet
            if (!rejuge.ok) return { ok: false, raison: `fichier refusé : ${rejuge.refusees} entrée(s) rejetée(s) par la validation d'entrée (${Object.entries(rejuge.motifs).map(([m, n]) => `${m} : ${n}`).join(' ; ')})` };
        } catch (e) { return { ok: false, raison: e && e.name === 'FormatInvalide' ? `fichier refusé : ${e.motif}` : `fichier illisible (${nom(e)})` }; }
        return { ok: true, version: v, comptes: { sets: ent.sets ?? 0, cartes: ent.cartes ?? 0, produits: ent.produits ?? 0, catalogue: ent.catalogue ?? 0, visuels: v.comptes.visuels, refusees: v.comptes.refusees, motifs: v.comptes.motifs, doublons: v.comptes.doublons ?? 0, doublonsContradictoires: v.comptes.doublonsContradictoires ?? 0,
            fichesLiees: v.comptes.fichesLiees, setsAvecLiens: v.comptes.setsAvecLiens, produitsLies: v.comptes.produitsLies } };
    };
}

function creerChargeur(opts = {}) {
    const catalogue = opts.catalogue || catalogueApi;
    const executer = opts.executer || (opts.source ? executerEnLigne({ source: opts.source, regle: opts.regle, decider: opts.decider }) : executerDansUnFil({ env: opts.env || process.env }));
    const pret = opts.pret || attendreBase;
    const journal = opts.journal || (m => (/^(✅|ℹ️)/.test(m) ? console.log(m) : console.error(m)));
    const T = opts.minuteurs || { setInterval, clearInterval };
    const planifier = opts.planifier || (fn => setImmediate(fn));
    let enCours = false, jour = null, vivant = false;

    /** @returns {Promise<{ ok: boolean, motif?: string, comptes?: object }>} — ne lève jamais. */
    async function charger() {
        if (enCours) return { ok: false, motif: 'un chargement est déjà en cours' };
        enCours = true;
        const t0 = Date.now();
        let comptes = {};
        try {
            const meta = await catalogue();
            const r = await executer({ catalogue: meta });
            if (!r.ok) { journal(`ℹ️ [v2 chargeur] sans chargement, ${etat.version() ? 'version précédente gardée' : 'aucune version en place (sans visuel)'} : ${r.raison}`); return { ok: false, motif: r.raison }; }
            comptes = r.comptes; const v = r.version;
            const dit = `sets ${comptes.sets} · cartes ${comptes.cartes} · cartes_produits ${comptes.produits} · catalogue ${comptes.catalogue} · entrées ${comptes.visuels} · refusées ${comptes.refusees}${comptes.refusees ? ` (${Object.entries(comptes.motifs).map(([m, n]) => `${m} : ${n}`).join(' ; ')})` : ''}${comptes.doublonsContradictoires ? ` · ${comptes.doublonsContradictoires} produit(s) sans visuel (doublons contradictoires)` : ''} · fiches liées ${comptes.fichesLiees} (produits ${comptes.produitsLies}, sets ${comptes.setsAvecLiens})`;
            // les critères d'ÉCHEC : écrits par ce qu'ils protègent (jamais une version vide ni amputée)
            if (!v || comptes.visuels === 0) throw new Echec(`0 visuel sur une base non vide — ${dit}`);
            if (comptes.fichesLiees === 0) throw new Echec(`0 lien fiche → produits sur une base non vide — ${dit}`);
            const prev = etat.version();
            if (prev) {
                // une archive plus ANCIENNE que celle en place (rejouée à l'envers) est refusée ; sa date et son âge sont journalisés au chargement
                if (v.chargeLe < prev.chargeLe) throw new Echec(`archive plus ancienne que celle en place (${v.chargeLe.toISOString()} < ${prev.chargeLe.toISOString()})`);
                const perdu = (a, b) => a > 0 && b < a * (1 - PERTE_MAX);
                if (perdu(prev.comptes.visuels, comptes.visuels)) throw new Echec(`perte de plus de 10 % des visuels (${prev.comptes.visuels} → ${comptes.visuels}) — ${dit}`);
                if (perdu(prev.comptes.fichesLiees, comptes.fichesLiees)) throw new Echec(`perte de plus de 10 % des fiches liées (${prev.comptes.fichesLiees} → ${comptes.fichesLiees}) — ${dit}`);
            }
            etat.installer(v);                                                       // LA bascule : un seul pointeur, la version précédente n'est plus référencée ensuite
            journal(`✅ [v2 chargeur] chargé en ${((Date.now() - t0) / 1000).toFixed(1)} s : ${dit} · ${(v.octets.total / 1048576).toFixed(1)} Mo en colonnes · archive du ${v.chargeLe.toISOString()} (âge ${Math.max(0, Math.round((Date.now() - v.chargeLe.getTime()) / 3600000))} h)`);
            return { ok: true, comptes };
        } catch (e) {
            const motif = e instanceof Echec ? e.motif : `lecture impossible (${nom(e)})`;
            journal(`❌ [v2 chargeur] échec, ${etat.version() ? 'version précédente gardée' : 'aucune version en place (sans visuel)'}, aucun nouvel essai (prochain essai : le prochain réveil de l'instance ou le rechargement quotidien) : ${motif}`);
            return { ok: false, motif, comptes };
        } finally { enCours = false; }
    }

    /** Un essai du cycle : attendre la base de l'API (bornée), puis UN chargement. Jamais de reprise. */
    async function essai() {
        if (!vivant) return;
        if (!(await pret())) { journal('❌ [v2 chargeur] la base de l\'API n\'est pas prête : pas de chargement, prochain essai au rechargement quotidien'); return; }
        await charger();
    }
    /** Ne lit RIEN : le premier chargement est différé, le minuteur est quotidien. Idempotent (un seul minuteur vivant). */
    function demarrer() {
        arreter();
        vivant = true;
        planifier(() => { essai(); });
        jour = T.setInterval(() => { essai(); }, JOUR_MS);
        if (jour && jour.unref) jour.unref();
    }
    function arreter() { vivant = false; if (jour) { T.clearInterval(jour); jour = null; } }
    return { charger, demarrer, arreter };
}

/** Le catalogue de l'API (sa propre base) : idProduct → idMetacard. */
async function catalogueApi() {
    const m = new Map();
    const curseur = require('../db').col('catalogue_produits').find({}, { projection: { idProduct: 1, idMetacard: 1 } });
    for await (const c of curseur) m.set(c.idProduct, c.idMetacard);
    return m;
}
/** Attend la connexion de la base de l'API (bornée) : une ATTENTE, pas un essai de chargement. */
async function attendreBase({ delaiMs = ATTENTE_BASE_MS, pasMs = 250 } = {}) {
    const mongoose = require('mongoose');
    const fin = Date.now() + delaiMs;
    while (mongoose.connection.readyState !== 1) { if (Date.now() >= fin) return false; await new Promise(r => { const t = setTimeout(r, pasMs); if (t.unref) t.unref(); }); }
    return true;
}

module.exports = { creerChargeur, executerEnLigne, executerDansUnFil, executerDepuisFichier, sourceCartes, catalogueApi, attendreBase, PROJECTIONS, JOUR_MS, PERTE_MAX, LIMITES_FIL, DELAI_FIL_MS, FIL };
