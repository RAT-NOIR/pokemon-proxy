// ============================================================
// COLLECTEUR D'IMAGES « pmk » (récolte RECOLTE2, 2026-10-24) — pages de sets chinois (Happy Sets) : l'ORIGINAL de la carte du tirage exact, 300 px
// ============================================================
//   node collecteur-images-packmagik.js --plan                          (lecture seule : la base, les relevés ; ce que la source couvre, la décision de chaque unité -> plan-pmk.json)
//   node collecteur-images-packmagik.js --releve --plafond=<N>          (les pages de sets de la table fermée : 1 requête chacune + robots.txt -> releves-pmk.json)
//   node collecteur-images-packmagik.js --telecharger --plafond=<N> [--limite=<M>]   (les originaux des unités à ajouter : vraie image, ratio de carte, largeur -> images-pmk.json)
//   node collecteur-images-packmagik.js --planche --echantillon=<N> [--basse-definition]   (planches étiquetées, À REGARDER avant d'écrire)
//   node collecteur-images-packmagik.js --compter [--basse-definition]  (lecture seule : le nombre pour --attendu, par la décision de l'écriture, AUCUNE écriture)
//   node lot-additif.js --quoi="PMK : N images" --collections=cartes,images,sets,collecte_images_etat -- node collecteur-images-packmagik.js --ecrire --attendu=N     (AUCUNE requête : le cache seulement)
//   node collecteur-images-packmagik.js --retirer                       (à blanc : le retrait exact du lot ; l'écriture passe par retirer-visuels-recolte.js --source=pmk)
// (la grammaire, le téléchargement, les planches, le compte, le retrait et l'écriture : collecte-cartes/recolte-cli.js, communs aux collecteurs.)
//
// ⚠️ 300 px < 350 px : tant que la source n'est pas nommée dans la liste fermée du plancher de 200 px (seuils-images.js, décision du testeur), toute image est `trop-petit` et --compter rend 0.
// Toute requête passe par collecte-cartes/recolte-hote.js (client poli) : robots.txt de CHAQUE hôte relu, >= 5 s entre deux requêtes, un seul flux, redirections jamais suivies, arrêt DÉFINITIF sur
// 401/403/410/429/défi. AVANT la première requête, le maximum est compté et imprimé (§38). Aucun prix lu ni gardé. Le nom de la source n'apparaît jamais dans `source` (pmk), `lot` (pmk-2026-10), une clé R2
// (pmk/…) ni une mention.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const P = require('./collecte-cartes/packmagik');
const RC = require('./collecte-cartes/recolte-commun');
const HOTE = require('./collecte-cartes/recolte-hote');
const CLI = require('./collecte-cartes/recolte-cli');
const T = require('./collecte-cartes/tpc');
const J = require('./collecte-cartes/jointure');

const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\RECOLTE2';
const CODE = 'pmk';
const SRC = P.SRC;
const fichiersDe = (dossier, cache) => CLI.fichiersDe(CODE, dossier, cache);
const client = (F, plafondTotal, o = {}) => P.fabriquerClient({ dossierCache: F.cache, plafond: HOTE.plafondRestant(F.cache, plafondTotal), journal: F.journal, ...o });
const arretDe = e => (e.plafond ? 'plafond' : e.arretDefinitif || e.bloque ? 'arret-definitif' : e.pauseHote ? 'pause-hote' : 'interrompu');

// ── 0. LE MAXIMUM du relevé, compté et imprimé AVANT la première requête (§38) ───────────────────────────────────────────────
function maximumReleve({ F, releves = {}, plafondTotal }) {
    const enCache = url => fs.existsSync(path.join(F.cache, HOTE.nomCache(url)));
    const pages = P.TABLE.filter(l => !releves[l.code] && !enCache(P.urlPage(l.code)));
    const robots = HOTE.robotsFrais(F.cache, P.HOTE_PAGES) ? 0 : 1;           // un robots.txt de plus de 24 h se redemande
    const total = robots + pages.length;
    return { total, detail: `robots.txt ${robots} + pages de sets ${pages.length}`, secondes: total * 6, plafondTotal, dejaAuCache: HOTE.nbCache(F.cache) };
}

// ── 1. LE RELEVÉ des pages de sets ───────────────────────────────────────────────────────────────────────────────────────────
async function releve({ cli, fichier, lignes = P.TABLE }) {
    const rel = RC.lireJson(fichier, {});
    let etat = 'termine', motif = null, lues = 0, transitoires = 0, consecutifs = 0;
    try {
        await cli.initialiserRobots(P.HOTE_PAGES);
        for (const l of lignes) {
            if (rel[l.code]?.le) continue;
            let r;
            try { r = await cli.lire(P.urlPage(l.code), { reduire: h => P.reduirePage(h, l.dossier) }); }
            catch (e) {
                if (!e.transitoire) throw e;
                transitoires++;
                if (++consecutifs >= 2) { etat = 'serveur-indisponible'; motif = `deux erreurs serveur de suite (${e.message})`; break; }
                continue;
            }
            consecutifs = 0;
            lues++;
            if (r.status === 404) { rel[l.code] = { page: l.page, absente: true, le: new Date().toISOString() }; continue; }
            const page = P.lirePage(r.texte, l.dossier), verdict = P.verdictDePage(page, l);
            rel[l.code] = { page: l.page, le: r.le ?? new Date().toISOString(), titre: page.titre, h1: page.h1, horsSet: page.horsSet, verdict, tuiles: page.tuiles };
            RC.ecrireJson(fichier, rel);
        }
    } catch (e) { etat = arretDe(e); motif = e.message; }
    RC.ecrireJson(fichier, rel);
    cli.liberer?.();                      // le verrou de l'hôte est rendu
    const v = lignes.map(l => rel[l.code]);
    const refusees = v.filter(x => x && x.verdict && !x.verdict.ok).length, absentes = v.filter(x => x?.absente).length, tuiles = v.filter(Boolean).reduce((n, x) => n + (x.tuiles?.length ?? 0), 0);
    return { etat, motif, transitoires, requetes: cli.requetes(), requetesParHote: cli.requetesParHote(), codes: cli.codes(), pages: lignes.length, relevees: v.filter(Boolean).length, lues, refusees, absentes, tuiles, restantes: lignes.filter(l => !rel[l.code]).length,
        resume: `pages ${lignes.length} · relevées ${v.filter(Boolean).length} (refusées par la garde de lecture ${refusees}, absentes ${absentes}) · tuiles ${tuiles} · restantes ${lignes.filter(l => !rel[l.code]).length}` };
}

// ── 2. LE PLAN : la base (lecture seule) + les relevés -> les unités et la décision de chacune ──────────────────────────────
async function construirePlan({ db, releves }) {
    const parSet = [], unites = [], restes = [];
    for (const ligne of P.TABLE) {
        const r = releves[ligne.code];
        const lu = await RC.lireSet(db, ligne.slug, { tirage: SRC.TIRAGE, code: ligne.code });
        if (lu.refus) { parSet.push({ code: ligne.code, slug: ligne.slug, etat: 'set-refuse', motif: lu.refus }); continue; }
        const produits = RC.produitsDuSet(lu);
        const servis = produits.filter(p => T.dejaServi(lu.cartes.get(p.carteId), ligne.slug, p.numeroFiche)).length;
        const basse = produits.filter(p => (lu.cartes.get(p.carteId)?.images || []).some(e => e.set === ligne.slug && e.basseDefinition === true && (e.numero == null || J.cleNumero(e.numero) === J.cleNumero(p.numeroFiche)))).length;
        const ligneRapport = { code: ligne.code, slug: ligne.slug, produits: produits.length, deja_servis: servis, dont_basse_definition: basse, sans_visuel: produits.length - servis };
        if (!r || r.absente) { parSet.push({ ...ligneRapport, etat: r?.absente ? 'page-absente' : 'non-relevee' }); continue; }
        if (!r.verdict?.ok) { parSet.push({ ...ligneRapport, etat: 'page-refusee', motif: r.verdict?.motif }); continue; }
        const temoin = J.temoinDuNom([...lu.cartes.values()].filter(c => c.nomEn));
        const pl = P.planifier({ ligne, page: { tuiles: r.tuiles, horsSet: r.horsSet }, produits, temoin });
        parSet.push({ ...ligneRapport, etat: 'planifie', tuilesPage: r.tuiles.length, unites: pl.unites.length, restes: pl.parMotif, base: pl.base });
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

const def = { CODE, SRC, DOSSIER, hoteImages: P.HOTE_IMAGES, hotesLibelle: `hôte ${P.HOTE_PAGES}`, clientDe: client, maximumReleve, releve, construirePlan };
if (require.main !== module) { module.exports = { maximumReleve, maximumImages: CLI.maximumImages, releve, construirePlan, fichiersDe, client, def, DOSSIER, CODE }; return; }
// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
CLI.lancer(def);
