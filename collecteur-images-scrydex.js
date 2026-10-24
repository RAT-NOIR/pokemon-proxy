// ============================================================
// COLLECTEUR D'IMAGES « scx » (récolte RECOLTE2, 2026-10-24) — pages d'extensions d'un site de cartes : l'ORIGINAL de la carte du tirage exact (McDonald's, kits Dresseur)
// ============================================================
//   node collecteur-images-scrydex.js --plan                          (lecture seule : la base, les relevés ; ce que la source couvre, la décision de chaque unité -> plan-scx.json)
//   node collecteur-images-scrydex.js --releve --plafond=<N>          (les pages d'extensions de la table fermée : 1 requête chacune + robots.txt -> releves-scx.json)
//   node collecteur-images-scrydex.js --telecharger --plafond=<N> [--limite=<M>]   (les originaux des unités à ajouter : vraie image, ratio de carte, largeur >= 350, jamais le dos de carte -> images-scx.json)
//   node collecteur-images-scrydex.js --planche --echantillon=<N>     (planches étiquetées, À REGARDER avant d'écrire)
//   node collecteur-images-scrydex.js --compter                       (lecture seule : le nombre pour --attendu, par la décision de l'écriture, AUCUNE écriture)
//   node lot-additif.js --quoi="SCX : N images" --collections=cartes,images,sets,collecte_images_etat -- node collecteur-images-scrydex.js --ecrire --attendu=N     (AUCUNE requête : le cache seulement)
//   node collecteur-images-scrydex.js --retirer                       (à blanc : le retrait exact du lot ; l'écriture passe par retirer-visuels-recolte.js --source=scx)
// (la grammaire, le téléchargement, les planches, le compte, le retrait et l'écriture : collecte-cartes/recolte-cli.js, communs aux collecteurs.)
//
// Toute requête passe par collecte-cartes/recolte-hote.js (client poli) -> collecte-cartes/reponse-hote.js (règle commune) : robots.txt de CHAQUE hôte relu, >= 5 s entre deux requêtes, un seul flux,
// redirections jamais suivies, arrêt DÉFINITIF sur 401/403/410/429/défi. Le plafond (`--plafond=`) est un TOTAL pour le dossier de cache : une réponse en cache n'est jamais redemandée.
// AVANT la première requête, le maximum que le lancement peut faire est compté et imprimé (§38). Aucun prix lu ni gardé (la page est réduite avant d'être gardée). Le nom de la source n'apparaît jamais
// dans `source` (scx), `lot` (scx-2026-10), une clé R2 (scx/…) ni une mention.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const S = require('./collecte-cartes/scrydex');
const RC = require('./collecte-cartes/recolte-commun');
const HOTE = require('./collecte-cartes/recolte-hote');
const CLI = require('./collecte-cartes/recolte-cli');
const T = require('./collecte-cartes/tpc');
const J = require('./collecte-cartes/jointure');

const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\RECOLTE2';
const CODE = 'scx';
const SRC = S.SRC;
const fichiersDe = (dossier, cache) => CLI.fichiersDe(CODE, dossier, cache);
const client = (F, plafondTotal, o = {}) => S.fabriquerClient({ dossierCache: F.cache, plafond: HOTE.plafondRestant(F.cache, plafondTotal), journal: F.journal, ...o });
const arretDe = e => (e.plafond ? 'plafond' : e.arretDefinitif || e.bloque ? 'arret-definitif' : e.pauseHote ? 'pause-hote' : 'interrompu');
const MOITIES = S.TABLE.flatMap(l => l.moities.map(m => ({ ...m, code: l.code })));

// ── 0. LE MAXIMUM du relevé, compté et imprimé AVANT la première requête (§38) ───────────────────────────────────────────────
function maximumReleve({ F, releves = {}, plafondTotal }) {
    const enCache = url => fs.existsSync(path.join(F.cache, HOTE.nomCache(url)));
    const pages = MOITIES.filter(m => !releves[m.id] && !enCache(S.urlPage(m.id)));
    const robots = HOTE.robotsFrais(F.cache, S.HOTE_PAGES) ? 0 : 1;           // un robots.txt de plus de 24 h se redemande
    const total = robots + pages.length;
    return { total, detail: `robots.txt ${robots} + pages d'extensions ${pages.length}`, secondes: total * 6, plafondTotal, dejaAuCache: HOTE.nbCache(F.cache) };
}

// ── 1. LE RELEVÉ des pages d'extensions (une par moitié) ─────────────────────────────────────────────────────────────────────
async function releve({ cli, fichier, moities = MOITIES }) {
    const rel = RC.lireJson(fichier, {});
    let etat = 'termine', motif = null, lues = 0, transitoires = 0, consecutifs = 0;
    try {
        await cli.initialiserRobots(S.HOTE_PAGES);
        for (const m of moities) {
            if (rel[m.id]?.le) continue;
            let r;
            try { r = await cli.lire(S.urlPage(m.id), { reduire: S.reduirePage }); }
            catch (e) {
                if (!e.transitoire) throw e;
                transitoires++;
                if (++consecutifs >= 2) { etat = 'serveur-indisponible'; motif = `deux erreurs serveur de suite (${e.message})`; break; }
                continue;
            }
            consecutifs = 0;
            lues++;
            if (r.status === 404) { rel[m.id] = { page: m.page, absente: true, le: new Date().toISOString() }; continue; }
            const page = S.lirePage(r.texte), verdict = S.verdictDePage(page, m);
            rel[m.id] = { page: m.page, le: r.le ?? new Date().toISOString(), titre: page.titre, h1: page.h1, entete: page.entete, verdict, tuiles: page.tuiles };
            RC.ecrireJson(fichier, rel);
        }
    } catch (e) { etat = arretDe(e); motif = e.message; }
    RC.ecrireJson(fichier, rel);
    cli.liberer?.();                      // le verrou de l'hôte est rendu
    const v = moities.map(m => rel[m.id]);
    const refusees = v.filter(x => x && x.verdict && !x.verdict.ok).length, absentes = v.filter(x => x?.absente).length, tuiles = v.filter(Boolean).reduce((n, x) => n + (x.tuiles?.length ?? 0), 0);
    return { etat, motif, transitoires, requetes: cli.requetes(), requetesParHote: cli.requetesParHote(), codes: cli.codes(), pages: moities.length, relevees: v.filter(Boolean).length, lues, refusees, absentes, tuiles, restantes: moities.filter(m => !rel[m.id]).length,
        resume: `pages ${moities.length} · relevées ${v.filter(Boolean).length} (refusées par la garde de lecture ${refusees}, absentes ${absentes}) · tuiles ${tuiles} · restantes ${moities.filter(m => !rel[m.id]).length}` };
}

// ── 2. LE PLAN : la base (lecture seule) + les relevés -> les unités et la décision de chacune ──────────────────────────────
async function construirePlan({ db, releves }) {
    const parSet = [], unites = [], restes = [];
    for (const ligne of S.TABLE) {
        const lu = await RC.lireSet(db, ligne.slug, { tirage: SRC.TIRAGE, code: ligne.code });
        if (lu.refus) { parSet.push({ code: ligne.code, slug: ligne.slug, etat: 'set-refuse', motif: lu.refus }); continue; }
        const produits = RC.produitsDuSet(lu);
        const servis = produits.filter(p => T.dejaServi(lu.cartes.get(p.carteId), ligne.slug, p.numeroFiche)).length;
        const basse = produits.filter(p => (lu.cartes.get(p.carteId)?.images || []).some(e => e.set === ligne.slug && e.basseDefinition === true && (e.numero == null || J.cleNumero(e.numero) === J.cleNumero(p.numeroFiche)))).length;
        const ligneRapport = { code: ligne.code, slug: ligne.slug, produits: produits.length, deja_servis: servis, dont_basse_definition: basse, sans_visuel: produits.length - servis };
        // les pages admises par la garde de lecture : une extension absente, refusée ou non relevée laisse ses produits sans image, avec ce motif
        const pages = {}, etats = {};
        for (const m of ligne.moities) {
            const r = releves[m.id];
            etats[m.id] = !r ? 'non-relevee' : r.absente ? 'page-absente' : !r.verdict?.ok ? `page-refusee (${r.verdict?.motif})` : 'lue';
            if (etats[m.id] === 'lue') pages[m.id] = { entete: r.entete, tuiles: r.tuiles };
        }
        if (!Object.keys(pages).length) { parSet.push({ ...ligneRapport, etat: 'aucune-page-lue', pages: etats }); continue; }
        const temoin = J.temoinDuNom([...lu.cartes.values()].filter(c => c.nomEn));
        const pl = S.planifier({ ligne, pages, produits, temoin });
        parSet.push({ ...ligneRapport, etat: 'planifie', pages: etats, tuilesPages: pl.base.tuiles, unites: pl.unites.length, restes: pl.parMotif, base: pl.base });
        unites.push(...pl.unites);
        for (const x of pl.restes) restes.push({ code: ligne.code, ...x });
    }
    const decidees = await RC.decider(SRC, unites, RC.lecteurNatif(db));
    const decisions = {};
    for (const u of decidees) { const k = `${u.groupe}:${u.decision.action}`; decisions[k] = (decisions[k] || 0) + 1; }
    const aAjouter = decidees.filter(u => u.decision.action === 'ajouter');
    const remplacent = aAjouter.filter(u => u.decision.remplace.length).length;
    const resume = { le: new Date().toISOString(), source: SRC.SOURCE, lot: SRC.LOT, parSet, unitesProuvees: unites.length, decisions, aAjouter: aAjouter.length, dontRemplacentUneBasseDefinition: remplacent, restesParMotif: restes.reduce((m, r) => (m[r.motif] = (m[r.motif] || 0) + 1, m), {}) };
    return { resume, unites: decidees, restes };
}

const def = { CODE, SRC, DOSSIER, hoteImages: S.HOTE_IMAGES, hotesLibelle: `hôte ${S.HOTE_PAGES}`, clientDe: client, maximumReleve, releve, construirePlan };
if (require.main !== module) { module.exports = { maximumReleve, maximumImages: CLI.maximumImages, releve, construirePlan, fichiersDe, client, def, DOSSIER, CODE, MOITIES }; return; }
// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
CLI.lancer(def);
