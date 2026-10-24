// ============================================================
// COLLECTEUR D'IMAGES « tcs » (récolte RECOLTE, 2026-10-24) — Prize Packs et kit Sandslash : l'image du produit du marché
// ============================================================
//   node collecteur-images-tcgcsv.js --releve --plafond=<N>            (robots.txt du miroir, la liste des groupes, les produits des deux groupes de la table -> releves-tcs.json ; JSON SEULEMENT)
//   node collecteur-images-tcgcsv.js --plan                            (lecture seule : la base, les relevés ; ce que la source prouverait, la décision de chaque unité -> plan-tcs.json ; dit si les images sont FERMÉES)
//   node collecteur-images-tcgcsv.js --telecharger --plafond=<N> [--limite=<M>]   (refusé sans une requête tant que l'arrêt durable de l'hôte des images tient)
//   node collecteur-images-tcgcsv.js --planche | --compter | --ecrire --attendu=N | --retirer       (les mêmes modes que le collecteur ppr : collecte-cartes/recolte-cli.js)
//
// ⛔ LES IMAGES SONT FERMÉES (2026-10-24) : le robots.txt de l'hôte des images répondait 403 le 24/10 (sonde de la recherche) ET à la relecture de la récolte ; la règle du testeur est « un 403 est
// un arrêt définitif ». L'arrêt durable est écrit (ARRET-HOTE-tcgplayer.com.json, dossier des arrêts) ; aucune image n'est demandée, aucun autre hôte et aucune autre taille ne se devine. Le miroir de
// DONNÉES (robots.txt : Allow: /) reste lu — pour mesurer ce que la source prouverait, jamais un prix : on n'ouvre que les listes de produits, jamais `/prices`.
// Le nom de la source n'apparaît jamais dans `source` (tcs), `lot` (tcs-2026-10), une clé R2 (tcs/…) ni une mention.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TC = require('./collecte-cartes/tcgcsv');
const RC = require('./collecte-cartes/recolte-commun');
const HOTE = require('./collecte-cartes/recolte-hote');
const RH = require('./collecte-cartes/reponse-hote');
const CLI = require('./collecte-cartes/recolte-cli');

const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\RECOLTE';
const CODE = 'tcs';
const SRC = TC.SRC;
const fichiersDe = (dossier, cache) => CLI.fichiersDe(CODE, dossier, cache);
const client = (F, plafondTotal, o = {}) => TC.fabriquerClient({ dossierCache: F.cache, plafond: HOTE.plafondRestant(F.cache, plafondTotal), journal: F.journal, ...o });
const arretDe = e => (e.plafond ? 'plafond' : e.arretDefinitif || e.bloque ? 'arret-definitif' : e.pauseHote ? 'pause-hote' : 'interrompu');

// ── 0. LE MAXIMUM du relevé (§38) : robots.txt + la liste des groupes + un fichier par groupe de la table ──────────────────────
function maximumReleve({ F, releves = {}, plafondTotal }) {
    const enCache = url => fs.existsSync(path.join(F.cache, HOTE.nomCache(url)));
    const robots = enCache(`https://${TC.HOTE_DONNEES}/robots.txt`) ? 0 : 1;
    const groupes = enCache(TC.urlGroupes(3)) ? 0 : 1;
    const produits = TC.GROUPES.filter(g => !releves[g.groupId] && !enCache(TC.urlProduits(3, g.groupId))).length;
    const total = robots + groupes + produits;
    return { total, detail: `robots.txt ${robots} + liste des groupes ${groupes} + listes de produits ${produits}`, secondes: total * 6, plafondTotal, dejaAuCache: HOTE.nbCache(F.cache) };
}

// ── 1. LE RELEVÉ (JSON seulement) ────────────────────────────────────────────────────────────────────────────────────────────
async function releve({ cli, fichier }) {
    const rel = RC.lireJson(fichier, {});
    let etat = 'termine', motif = null, transitoires = 0, consecutifs = 0, lues = 0;
    try {
        await cli.initialiserRobots(TC.HOTE_DONNEES);
        if (!rel.groupes) {
            const g = await cli.lire(TC.urlGroupes(3));
            if (g.status !== 200) throw new Error(`liste des groupes : HTTP ${g.status}`);
            rel.groupes = { le: g.le, ...TC.verifierGroupes(g.texte) };            // LÈVE si un groupe de la table manque ou a changé de nom
            lues++;
        }
        for (const g of TC.GROUPES) {
            if (rel[g.groupId]?.produits) continue;
            let r;
            try { r = await cli.lire(TC.urlProduits(3, g.groupId), { reduire: TC.reduireProduits }); }
            catch (e) {
                if (!e.transitoire) throw e;
                transitoires++;
                if (++consecutifs >= 2) { etat = 'serveur-indisponible'; motif = `deux erreurs serveur de suite (${e.message})`; break; }
                continue;
            }
            consecutifs = 0; lues++;
            if (r.status !== 200) { rel[g.groupId] = { nom: g.nom, absente: true, le: r.le }; continue; }
            const j = JSON.parse(TC.reduireProduits(r.texte));          // le cache peut porter la liste entière (une sonde) ou réduite : la même forme dans les deux cas
            if (!j.results.every(p => p.groupId === g.groupId)) throw new Error(`le groupe ${g.groupId} rend des produits d'un autre groupe — on ne lit pas`);
            rel[g.groupId] = { nom: g.nom, le: r.le, produits: j.results };
            RC.ecrireJson(fichier, rel);
        }
    } catch (e) { etat = arretDe(e); motif = e.message; }
    RC.ecrireJson(fichier, rel);
    const lus = TC.GROUPES.filter(g => rel[g.groupId]?.produits);
    return { etat, motif, transitoires, requetes: cli.requetes(), requetesParHote: cli.requetesParHote(), codes: cli.codes(), lues,
        resume: `groupes lus ${lus.length}/${TC.GROUPES.length} (${lus.map(g => `${g.code} ${rel[g.groupId].produits.length} produits`).join(', ')}) · liste des groupes ${rel.groupes ? 'lue' : 'non lue'}` };
}

// ── 2. LE PLAN ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function construirePlan({ db, releves, dossierArrets = RH.DOSSIER_PAUSES }) {
    const arret = RH.hoteArrete(TC.RACINE_IMAGES, dossierArrets);
    const parGroupe = [], unites = [], restes = [];
    for (const g of TC.GROUPES) {
        const r = releves[g.groupId];
        const lignes = [], etats = [];
        for (const slug of g.slugs) {
            const lu = await RC.lireSet(db, slug, { tirage: SRC.TIRAGE, code: null, impressions: true });
            if (lu.refus) { etats.push({ slug, etat: 'set-refuse', motif: lu.refus }); continue; }
            const produits = RC.produitsDuSet(lu).map(p => ({ ...p, slugSet: slug }));
            lignes.push(...produits);
            etats.push({ slug, produits: produits.length, deja_servis: produits.filter(p => (lu.cartes.get(p.carteId)?.images || []).some(e => e.set === slug)).length, dont_basse_definition: produits.filter(p => (lu.cartes.get(p.carteId)?.images || []).some(e => e.set === slug && e.basseDefinition === true)).length });
        }
        if (!r?.produits) { parGroupe.push({ code: g.code, groupId: g.groupId, etat: 'non-releve', sets: etats }); continue; }
        const pl = g.famille === 'pp' ? TC.planifierPrizePacks({ lignes, produits: r.produits }) : TC.planifierKit({ lignes, produits: r.produits, code: g.code });
        parGroupe.push({ code: g.code, groupId: g.groupId, famille: g.famille, etat: 'planifie', sets: etats, produitsNotres: lignes.length, unites: pl.unites.length, restes: pl.parMotif, base: pl.base });
        unites.push(...pl.unites);
        for (const x of pl.restes) restes.push({ code: g.code, ...x });
    }
    const decidees = await RC.decider(SRC, unites, RC.lecteurNatif(db));
    const decisions = {};
    for (const u of decidees) { const k = `${u.groupe}:${u.decision.action}`; decisions[k] = (decisions[k] || 0) + 1; }
    const aAjouter = decidees.filter(u => u.decision.action === 'ajouter');
    const imagesFermees = arret ? { fermees: true, hote: TC.HOTE_IMAGES, nature: arret.nature ?? null, le: arret.le ?? null, motif: arret.motif ?? null, illisible: !!arret.illisible } : { fermees: false };
    const resume = { le: new Date().toISOString(), source: SRC.SOURCE, lot: SRC.LOT, imagesFermees, parGroupe, unitesProuvees: unites.length, decisions, aAjouter: aAjouter.length, dontRemplacentUneBasseDefinition: aAjouter.filter(u => u.decision.remplace.length).length,
        restesParMotif: restes.reduce((m, r) => (m[r.motif] = (m[r.motif] || 0) + 1, m), {}),
        note: imagesFermees.fermees ? 'IMAGES FERMÉES : ces unités sont ce que la source PROUVERAIT ; aucune image n\'est téléchargeable tant que l\'arrêt durable de l\'hôte des images tient (seul le coordinateur le lève).' : 'images ouvertes' };
    return { resume, unites: decidees, restes };
}

const def = { CODE, SRC, DOSSIER, hoteImages: TC.HOTE_IMAGES, hotesLibelle: `hôtes ${TC.HOTE_DONNEES} (données) et ${TC.HOTE_IMAGES} (images : FERMÉ)`, clientDe: client, maximumReleve, releve, construirePlan };
if (require.main !== module) { module.exports = { maximumReleve, maximumImages: CLI.maximumImages, releve, construirePlan, fichiersDe, client, def, DOSSIER, CODE }; return; }
// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
CLI.lancer(def);
