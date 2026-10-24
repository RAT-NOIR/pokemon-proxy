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
const REPRISE_MS = 5 * 60 * 1000;                       // JUMEAU-V2 : la reprise tant que la colonne des jumeaux manque
const AGE_ALERTE_HEURES = 48;                           // JUMEAU-V2 : au-delà, l'archive en place est signalée en base
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
            fichesLiees: v.comptes.fichesLiees, setsAvecLiens: v.comptes.setsAvecLiens, produitsLies: v.comptes.produitsLies,
            // ARCHIVE-EXCLUSIONS : les compteurs de l'exclusion, seulement quand l'archive en porte (une archive d'avant n'en a pas : aucun champ inventé)
            ...(v.comptes.exclus !== undefined ? { exclus: v.comptes.exclus, exclusParMotif: v.comptes.exclusParMotif } : {}), ...(ent.repli && typeof ent.repli === 'object' ? ent.repli : {}) } };
    };
}

let avertiSansMarquages = false;           // m5 : l'avertissement « archive sans la colonne des marquages » n'est écrit qu'une fois par processus

function creerChargeur(opts = {}) {
    const catalogue = opts.catalogue || catalogueApi;
    const executer = opts.executer || (opts.source ? executerEnLigne({ source: opts.source, regle: opts.regle, decider: opts.decider }) : executerDansUnFil({ env: opts.env || process.env }));
    const pret = opts.pret || attendreBase;
    const journal = opts.journal || (m => (/^(✅|ℹ️)/.test(m) ? console.log(m) : console.error(m)));
    const T = opts.minuteurs || { setInterval, clearInterval, setTimeout, clearTimeout };
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
            // m1 : les compteurs du lot REPLI-REIMPRESSIONS (jamais seulement dans un banc) : marquages portés, produits sans image d'un autre tirage par famille, familles qui ressemblent à une liste fermée sans y figurer
            const repli = [];
            if (v && v.comptes && v.comptes.marquees) repli.push(`marquages ${Object.entries(v.comptes.marquees).map(([k, n]) => `${k} ${n}`).join(' ')}`);
            if (v && v.comptes && v.comptes.melange !== undefined) repli.push(`prix mélangés : produits marqués dans cartes_produits : ${comptes.melangeProduits ?? v.comptes.melange} · dans la colonne : ${v.comptes.melange}`);
            if (comptes.repliRefuse) repli.push(`sans image d'un autre tirage ${comptes.repliRefuse.total} (${Object.entries(comptes.repliRefuse.parFamille).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'aucune'})`);
            if (comptes.exclus !== undefined) repli.push(`exclus de l'identification ${comptes.exclus} (${Object.entries(comptes.exclusParMotif || {}).map(([k, n]) => `${k} ${n}`).join(', ')})`);
            if (Array.isArray(comptes.familleHorsListe) && comptes.familleHorsListe.length) repli.push(`FAMILLES HORS LISTE FERMÉE ${comptes.familleHorsListe.join(', ')}`);
            for (const [k, nom] of [['basseDefinitionExclue', 'basse définition exclue'], ['partageIncoherent', 'partage incohérent écarté'], ['varianteSansPreuve', 'variante sans preuve'], ['varianteHorsListe', 'variante hors liste']]) if (comptes[k]) repli.push(`${nom} ${comptes[k]}`);
            if (repli.length) journal(`ℹ️ [v2 chargeur] repli : ${repli.join(' · ')}`);
            // les critères d'ÉCHEC : écrits par ce qu'ils protègent (jamais une version vide ni amputée)
            if (!v || comptes.visuels === 0) throw new Echec(`0 visuel sur une base non vide — ${dit}`);
            if (comptes.fichesLiees === 0) throw new Echec(`0 lien fiche → produits sur une base non vide — ${dit}`);
            const prev = etat.version();
            // JUMEAU-V2 : une version sans la colonne des jumeaux ne remplace jamais une version qui l'a (la route n'affirmerait plus rien) ; sans version en place, elle s'installe (visuels servis, aucune affirmation)
            if (prev && prev.colonneJumeaux && !v.colonneJumeaux) throw new Echec(`la version chargée n'a pas la colonne des jumeaux alors que celle en place l'a — ${dit}`);
            if (!v.colonneJumeaux) journal('⚠️ [v2 chargeur] la version chargée n\'a PAS la colonne des jumeaux : la route n\'affirmera aucun produit tant qu\'une archive récente ne l\'aura pas apportée');
            // REPLI-REIMPRESSIONS : la même règle pour la colonne des marquages (format 2) — une version qui ne sait pas quels produits sont partagés ne remplace jamais une version qui le sait ; sans version en place,
            // elle s'installe (le comportement d'avant : rien n'est conclu sur les partages) et le journal le dit
            if (prev && prev.colonneMarquages && !v.colonneMarquages) throw new Echec(`la version chargée n'a pas la colonne des marquages alors que celle en place l'a — ${dit}`);
            if (!v.colonneMarquages && !avertiSansMarquages) { avertiSansMarquages = true; journal('⚠️ [v2 chargeur] la version chargée n\'a PAS la colonne des marquages (archive d\'avant le format 2) : l\'image pourra départager des produits que le catalogue déclare partagés tant qu\'une archive récente ne l\'aura pas apportée'); }       // m5 : UNE fois par processus, aucune valeur
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

    // JUMEAU-V2 (passe 2, I3) — l'ALERTE : écrite en base (v2/chargeur/alerte-archive.js, comme `alerte/file-vide` du worker) quand il n'y a aucune archive, que l'archive en place n'a pas la colonne des
    // jumeaux, ou qu'elle a plus de 48 h : sans elle, la route répond 503 sur toute affirmation et seul un journal le dit. Évaluée à la fin de CHAQUE essai du cycle ; une écriture qui échoue ne casse rien.
    const maintenant = opts.maintenant || Date.now;
    async function surveillerArchive() {
        if (typeof opts.alerte !== 'function') return;
        const v = etat.version(), age = v ? (maintenant() - v.chargeLe.getTime()) / 3600000 : null;
        const raison = !v ? 'sans-archive' : !v.colonneJumeaux ? 'sans-colonne' : age > AGE_ALERTE_HEURES ? 'ancienne' : null;
        try { await opts.alerte({ actif: raison !== null, raison, ageHeures: age === null ? null : Math.round(age), chargeLe: v ? v.chargeLe : null, maintenant: new Date(maintenant()) }); }
        catch (e) { journal(`❌ [v2 chargeur] l'alerte de l'archive n'a pas pu être écrite (${nom(e)})`); }
    }
    // JUMEAU-V2 (passe 2, I2) — LA SEULE REPRISE : tant que la colonne des jumeaux MANQUE (aucune version, ou une version d'avant la colonne), un essai est repris dans REPRISE_MS au lieu d'attendre le
    // réveil suivant (l'instance gratuite dort ~11 fois par jour ; chaque réveil repart d'une mémoire vide). Dès que la colonne est là, plus aucune reprise : la règle « aucun nouvel essai après un échec » reprend.
    let reprise = null;
    const colonnePresente = () => { const v = etat.version(); return Boolean(v && v.colonneJumeaux); };
    function armerReprise() {
        if (!vivant || reprise || colonnePresente() || typeof T.setTimeout !== 'function') return;
        reprise = T.setTimeout(() => { reprise = null; essai(); }, REPRISE_MS);
        if (reprise && reprise.unref) reprise.unref();
    }
    /** Un essai du cycle : attendre la base de l'API (bornée), puis UN chargement ; puis l'alerte, puis la reprise si la colonne manque. */
    async function essai() {
        if (!vivant) return;
        try {
            if (!(await pret())) { journal('❌ [v2 chargeur] la base de l\'API n\'est pas prête : pas de chargement, prochain essai au rechargement quotidien'); return; }
            await charger();
        } finally { await surveillerArchive(); armerReprise(); }
    }
    /** Ne lit RIEN : le premier chargement est différé, le minuteur est quotidien. Idempotent (un seul minuteur vivant). */
    function demarrer() {
        arreter();
        vivant = true;
        planifier(() => { essai(); });
        jour = T.setInterval(() => { essai(); }, JOUR_MS);
        if (jour && jour.unref) jour.unref();
    }
    function arreter() { vivant = false; if (jour) { T.clearInterval(jour); jour = null; } if (reprise) { if (typeof T.clearTimeout === 'function') T.clearTimeout(reprise); reprise = null; } }
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
