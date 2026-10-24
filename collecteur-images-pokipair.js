// ============================================================
// COLLECTEUR D'IMAGES « ppr » (récolte RECOLTE, 2026-10-24) — listes de sets chinois : l'ORIGINAL de la carte du tirage exact, 350 px
// ============================================================
//   node collecteur-images-pokipair.js --plan                          (lecture seule : la base, les relevés ; ce que la source couvre, la décision de chaque unité -> plan-ppr.json)
//   node collecteur-images-pokipair.js --releve --plafond=<N>          (les pages de listes de la table fermée : 1 requête chacune + robots.txt -> releves-ppr.json)
//   node collecteur-images-pokipair.js --telecharger --plafond=<N> [--limite=<M>]   (les originaux des unités à ajouter : vraie image, ratio de carte, largeur >= 350 -> images-ppr.json ; --limite : un échantillon de M unités)
//   node collecteur-images-pokipair.js --planche --echantillon=<N>     (planches étiquetées, À REGARDER avant d'écrire)
//   node collecteur-images-pokipair.js --compter                       (lecture seule : le nombre pour --attendu, par la décision de l'écriture, AUCUNE écriture)
//   node lot-additif.js --quoi="PPR : N images" --collections=cartes,images,sets,collecte_images_etat -- node collecteur-images-pokipair.js --ecrire --attendu=N     (AUCUNE requête : le cache seulement)
//   node collecteur-images-pokipair.js --retirer                       (à blanc : le retrait exact du lot ; l'écriture passe par retirer-visuels-recolte.js --source=ppr)
//
// Toute requête passe par collecte-cartes/recolte-hote.js (client poli) -> collecte-cartes/reponse-hote.js (règle commune) : robots.txt de CHAQUE hôte relu, >= 5 s entre deux requêtes, un seul flux,
// redirections jamais suivies, arrêt DÉFINITIF sur 401/403/410/429/défi. Le plafond (`--plafond=`) est un TOTAL pour le dossier de cache : une réponse en cache n'est jamais redemandée.
// AVANT la première requête, le maximum que le lancement peut faire est compté et imprimé (§38). Aucun prix lu ni gardé. Le nom de la source n'apparaît jamais dans `source` (ppr),
// `lot` (ppr-2026-10), une clé R2 (ppr/…) ni une mention.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const P = require('./collecte-cartes/pokipair');
const RC = require('./collecte-cartes/recolte-commun');
const HOTE = require('./collecte-cartes/recolte-hote');
const RH = require('./collecte-cartes/reponse-hote');
const T = require('./collecte-cartes/tpc');
const J = require('./collecte-cartes/jointure');
const { largeurMinDe } = require('./collecte-cartes/seuils-images');

const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\RECOLTE';
const CODE = 'ppr';
const SRC = P.SRC;
const fichiersDe = (dossier, cache) => ({ cache: RC.verifierChemin(cache ?? path.join(dossier, `cache-${CODE}`)), plan: path.join(dossier, `plan-${CODE}.json`), releves: path.join(dossier, `releves-${CODE}.json`), images: path.join(dossier, `images-${CODE}.json`),
    progression: path.join(dossier, `progression-${CODE}.json`), journal: path.join(dossier, `journal-${CODE}.jsonl`), essai: path.join(dossier, `essai-ecriture-${CODE}.txt`) });
const client = (F, plafondTotal, o = {}) => P.fabriquerClient({ dossierCache: F.cache, plafond: HOTE.plafondRestant(F.cache, plafondTotal), journal: F.journal, ...o });
const arretDe = e => (e.plafond ? 'plafond' : e.arretDefinitif || e.bloque ? 'arret-definitif' : e.pauseHote ? 'pause-hote' : 'interrompu');

// ── 0. LE MAXIMUM, compté et imprimé AVANT la première requête (§38) ─────────────────────────────────────────────────────────
function maximum({ F, mode, releves = {}, unites = [], indexImages = {}, plafondTotal }) {
    const enCache = url => fs.existsSync(path.join(F.cache, HOTE.nomCache(url)));
    if (mode === 'releve') {
        const pages = P.TABLE.filter(l => !releves[l.code] && !enCache(P.urlPage(l.page)));
        const robots = enCache(`https://${P.HOTE_PAGES}/robots.txt`) ? 0 : 1;
        const total = robots + pages.length;
        return { total, detail: `robots.txt ${robots} + pages de listes ${pages.length}`, secondes: total * 6, plafondTotal, dejaAuCache: HOTE.nbCache(F.cache) };
    }
    const urls = [...new Set(unites.map(u => u.url))].filter(u => !indexImages[u] && !enCache(u));
    const robots = enCache(`https://${P.HOTE_IMAGES}/robots.txt`) ? 0 : 1;
    const total = robots + urls.length;
    return { total, detail: `robots.txt ${robots} + originaux ${urls.length}`, secondes: total * 6, plafondTotal, dejaAuCache: HOTE.nbCache(F.cache) };
}

// ── 1. LE RELEVÉ des pages de listes ─────────────────────────────────────────────────────────────────────────────────────────
async function releve({ cli, fichier, lignes = P.TABLE }) {
    const rel = RC.lireJson(fichier, {});
    let etat = 'termine', motif = null, lues = 0, transitoires = 0, consecutifs = 0;
    try {
        await cli.initialiserRobots(P.HOTE_PAGES);
        for (const l of lignes) {
            if (rel[l.code]?.le) continue;
            let r;
            try { r = await cli.lire(P.urlPage(l.page), { reduire: P.reduirePage }); }
            catch (e) {
                if (!e.transitoire) throw e;
                transitoires++;
                if (++consecutifs >= 2) { etat = 'serveur-indisponible'; motif = `deux erreurs serveur de suite (${e.message})`; break; }
                continue;
            }
            consecutifs = 0;
            lues++;
            if (r.status === 404) { rel[l.code] = { page: l.page, absente: true, le: new Date().toISOString() }; continue; }
            const page = P.lirePage(r.texte), verdict = P.verdictDePage(page, l);
            rel[l.code] = { page: l.page, le: r.le ?? new Date().toISOString(), titre: page.titre, h1: page.h1, annonce: page.annonce, totalDominant: page.totalDominant, parTotal: page.parTotal, verdict, tuiles: page.tuiles };
            RC.ecrireJson(fichier, rel);
        }
    } catch (e) { etat = arretDe(e); motif = e.message; }
    RC.ecrireJson(fichier, rel);
    const v = lignes.map(l => rel[l.code]);
    return { etat, motif, transitoires, requetes: cli.requetes(), requetesParHote: cli.requetesParHote(), codes: cli.codes(), pages: lignes.length, relevees: v.filter(Boolean).length, lues, refusees: v.filter(x => x && x.verdict && !x.verdict.ok).length, absentes: v.filter(x => x?.absente).length,
        tuiles: v.filter(Boolean).reduce((n, x) => n + (x.tuiles?.length ?? 0), 0), restantes: lignes.filter(l => !rel[l.code]).length };
}

// ── 2. LE PLAN : la base (lecture seule) + les relevés -> les unités et la décision de chacune ──────────────────────────────
async function construirePlan({ db, releves }) {
    const parSet = [], unites = [], restes = [];
    for (const ligne of P.TABLE) {
        const r = releves[ligne.code];
        const lu = await RC.lireSet(db, ligne.slug, { tirage: SRC.TIRAGE, code: ligne.code });
        if (lu.refus) { parSet.push({ code: ligne.code, slug: ligne.slug, format: ligne.format, etat: 'set-refuse', motif: lu.refus }); continue; }
        const produits = RC.produitsDuSet(lu);
        const servis = produits.filter(p => T.dejaServi(lu.cartes.get(p.carteId), ligne.slug, p.numeroFiche)).length;
        const basse = produits.filter(p => (lu.cartes.get(p.carteId)?.images || []).some(e => e.set === ligne.slug && e.basseDefinition === true && (e.numero == null || J.cleNumero(e.numero) === J.cleNumero(p.numeroFiche)))).length;
        const ligneRapport = { code: ligne.code, slug: ligne.slug, format: ligne.format, produits: produits.length, deja_servis: servis, dont_basse_definition: basse, sans_visuel: produits.length - servis };
        if (!r || r.absente) { parSet.push({ ...ligneRapport, etat: r?.absente ? 'page-absente' : 'non-relevee' }); continue; }
        if (!r.verdict?.ok) { parSet.push({ ...ligneRapport, etat: 'page-refusee', motif: r.verdict?.motif }); continue; }
        const temoin = J.temoinDuNom([...lu.cartes.values()].filter(c => c.nomEn));
        const pl = P.planifier({ ligne, tuiles: r.tuiles, produits, temoin });
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

if (require.main !== module) { module.exports = { maximum, releve, construirePlan, fichiersDe, client, DOSSIER, CODE }; return; }

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
const AUTORISES = [/^--plan$/, /^--releve$/, /^--telecharger$/, /^--planche$/, /^--compter$/, /^--ecrire$/, /^--retirer$/, /^--plafond=\d{1,4}$/, /^--attendu=\d{1,5}$/, /^--echantillon=\d{1,3}$/, /^--limite=\d{1,4}$/, /^--dossier=.+$/, /^--cache=.+$/, /^--basse-definition$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const modes = ['--plan', '--releve', '--telecharger', '--planche', '--compter', '--ecrire', '--retirer'].filter(m => args.includes(m));
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
let erreurArgs = null;
if (inconnus.length) erreurArgs = `argument inconnu : ${inconnus.join(' ')}`;
else if (modes.length !== 1) erreurArgs = 'un seul mode parmi --plan, --releve, --telecharger, --planche, --compter, --ecrire, --retirer';
else if ((modes[0] === '--releve' || modes[0] === '--telecharger') && !val('plafond')) erreurArgs = `${modes[0]} exige --plafond=<N> (total pour le dossier de cache)`;
else if (modes[0] === '--ecrire' && !val('attendu')) erreurArgs = '--ecrire exige --attendu=<N>';
else if (val('attendu') && modes[0] !== '--ecrire') erreurArgs = '--attendu ne va qu\'avec --ecrire';
else if (val('echantillon') && modes[0] !== '--planche') erreurArgs = '--echantillon ne va qu\'avec --planche';
else if (val('limite') && modes[0] !== '--telecharger') erreurArgs = '--limite ne va qu\'avec --telecharger';
else if (val('plafond') && !['--releve', '--telecharger'].includes(modes[0])) erreurArgs = '--plafond ne va qu\'avec --releve ou --telecharger';
else if (args.includes('--basse-definition') && !['--compter', '--planche', '--ecrire'].includes(modes[0])) erreurArgs = '--basse-definition ne va qu\'avec --compter, --planche ou --ecrire';
if (erreurArgs) { console.error(`❌ ${erreurArgs}`); process.exitCode = 2; return; }

(async () => {
    const mode = modes[0];
    const dossier = RC.verifierChemin(val('dossier') ?? DOSSIER);
    const F = fichiersDe(dossier, val('cache'));
    const plafondTotal = Number(val('plafond') ?? 0);
    const lirePlan = () => { const p = RC.lireJson(F.plan, null); if (!p?.unites) throw new Error(`${F.plan} absent : lancer --plan d'abord`); return p; };
    const aFaireDe = plan => plan.unites.filter(u => u.decision?.action === 'ajouter');

    if (mode === '--releve') {
        const rel = RC.lireJson(F.releves, {});
        const m = maximum({ F, mode: 'releve', releves: rel, plafondTotal });
        console.log(`MAXIMUM de ce lancement : ${m.total} requête(s) (${m.detail}) · cadence ≥ 6 s ⇒ ${m.secondes} s au plus · plafond total ${m.plafondTotal} (déjà au cache : ${m.dejaAuCache}) · hôte ${P.HOTE_PAGES}`);
        const r = await releve({ cli: client(F, plafondTotal), fichier: F.releves, lignes: P.TABLE });
        console.log(`RELEVÉ : ${r.etat} · ${r.requetes} requête(s) ce passage ${JSON.stringify(r.requetesParHote)} codes ${JSON.stringify(r.codes)} · erreurs serveur sautées ${r.transitoires} · pages ${r.pages} · relevées ${r.relevees} (refusées par la garde de lecture ${r.refusees}, absentes ${r.absentes}) · tuiles ${r.tuiles} · restantes ${r.restantes}${r.motif ? ` · ${r.motif}` : ''}`);
        process.exitCode = r.etat === 'termine' || r.etat === 'plafond' ? 0 : 1;
        return;
    }
    if (mode === '--telecharger') {
        // `--limite=N` : un ÉCHANTILLON (déterministe, en tourniquet sur les sets) pour faire d'abord le chemin complet sur peu de produits ; sans lui, tout le lot
        const toutes = aFaireDe(lirePlan()), aFaire = val('limite') ? RC.choisirEchantillon(toutes, Number(val('limite'))) : toutes, idx = RC.lireJson(F.images, {});
        const m = maximum({ F, mode: 'telecharger', unites: aFaire, indexImages: idx, plafondTotal });
        console.log(`MAXIMUM de ce lancement : ${m.total} requête(s) (${m.detail}) · cadence ≥ 6 s ⇒ ${m.secondes} s au plus (${Math.round(m.secondes / 60)} min) · plafond total ${m.plafondTotal} (déjà au cache : ${m.dejaAuCache}) · hôte ${P.HOTE_IMAGES}${m.secondes > 600 ? ' · > 10 min : à lancer en arrière-plan (fichier de progression ' + F.progression + ')' : ''}`);
        if (m.total + m.dejaAuCache > plafondTotal) console.log(`⚠️ le maximum dépasse le plafond total : le lancement s'arrêtera au plafond (${plafondTotal}), reprise à la relance`);
        const cli = client(F, plafondTotal);
        const r = await RC.telecharger({ SRC, unites: aFaire, cli, fichier: F.images, hoteImages: P.HOTE_IMAGES, progression: F.progression });
        console.log(`TÉLÉCHARGEMENT : ${r.etat} · ${r.requetes} requête(s) ce passage ${JSON.stringify(cli.requetesParHote())} codes ${JSON.stringify(cli.codes())} · erreurs serveur sautées ${r.transitoires} · adresses ${r.adresses} · ${JSON.stringify(r.parStatut)} · restantes ${r.restantes}${r.motif ? ` · ${r.motif}` : ''}`);
        if (r.tropPetits.length) console.log(`   trop-petit (largeur < ${largeurMinDe(SRC.SOURCE)}) : ${JSON.stringify(r.tropPetits.slice(0, 20))}`);
        process.exitCode = r.etat === 'termine' || r.etat === 'plafond' ? 0 : 1;
        return;
    }
    const { ouvrirLecture } = require('./collecte-cartes/ouvrir-lecture');
    if (mode === '--plan') {
        const lecture = await ouvrirLecture();
        if (!lecture) throw new Error('MONGODB_CARTES_LECTURE_URI absente : le plan ne lit que par la connexion de lecture seule — refus, aucune connexion ouverte');
        try {
            const rel = RC.lireJson(F.releves, {});
            const plan = await construirePlan({ db: lecture.cartes.db, releves: rel });
            RC.ecrireJson(F.plan, plan);
            console.log(JSON.stringify(plan.resume, null, 1));
            console.log(`→ ${F.plan} (${plan.unites.length} unités, ${plan.restes.length} restes)`);
        } finally { await lecture.fermer(); }
        return;
    }
    const plan = lirePlan(), aFaire = aFaireDe(plan), indexImages = RC.lireJson(F.images, {});
    if (mode === '--planche') {
        const r = await RC.planches({ SRC, unites: aFaire, indexImages, dossierCache: F.cache, sortieDossier: dossier, n: Number(val('echantillon') ?? 50), basseDefinition: args.includes('--basse-definition'), prefixe: `planche-${CODE}${args.includes('--basse-definition') ? '-basse' : ''}` });
        console.log(`PLANCHES : ${r.images} image(s) · ${JSON.stringify(r.parGroupe)} · ${r.planches.join(' ; ')} (à REGARDER avant --ecrire)`);
        return;
    }
    if (mode === '--compter') {
        const lecture = await ouvrirLecture();
        if (!lecture) throw new Error('MONGODB_CARTES_LECTURE_URI absente : --compter ne lit que par la connexion de lecture seule');
        try {
            const M = { Carte: { db: { db: lecture.cartes.db } } };
            const r = await RC.ecrire({ SRC, unites: aFaire, M, dossierCache: F.cache, indexImages, compterSeulement: true, basseDefinition: args.includes('--basse-definition'), lecteur: RC.lecteurNatif(lecture.cartes.db) });
            console.log(`COMPTE${args.includes('--basse-definition') ? ' BASSE DÉFINITION' : ''} : --attendu=${r.reel} (cédées ${r.cedees}, déjà posées ${r.dejaPosees}, écartées ${r.ecartees}, trop petites ${r.tropPetits}, hors cache ${r.horsCache}, altérées ${r.altere}, retirées ${r.retires})`);
        } finally { await lecture.fermer(); }
        return;
    }
    if (mode === '--retirer') {
        const { planLu } = require('./retirer-visuels-recolte');
        const lecture = await ouvrirLecture();
        if (!lecture) throw new Error('MONGODB_CARTES_LECTURE_URI absente : --retirer (à blanc) ne lit que par la connexion de lecture seule');
        try {
            const p = await planLu(lecture.cartes.db, SRC);
            console.log(`RETRAIT À BLANC (source ${SRC.SOURCE}, lot ${SRC.LOT}) : ${p.cartes.length} cartes portent ${p.entrees} entrées · ${p.docs} documents « images » non retirés · ${p.cles.length} clés R2 (images et vignettes) · par set ${JSON.stringify(p.parSet)}`);
            console.log(`   écriture (sur demande du testeur) : node lot-additif.js --quoi="retrait de la source ${SRC.SOURCE}" --collections=cartes,images,sets --annonce=<annonce> -- node retirer-visuels-recolte.js --source=${SRC.SOURCE} --ecrire`);
        } finally { await lecture.fermer(); }
        return;
    }
    // --ecrire : seulement sous lot-additif.js, AUCUNE requête
    require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid);
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { modeles } = require('./collecte-cartes/schemas');
    const r2 = require('./collecte-cartes/r2');
    const { vignetterApresJointure } = require('./collecte-cartes/vignettes-apres-jointure');
    const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
    if (!process.env.R2_BUCKET_IMAGES) throw new Error('R2_BUCKET_IMAGES : nom de bucket absent — aucune écriture');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    try {
        await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
        const r = await RC.ecrire({ SRC, unites: aFaire, M: modeles(cx), dossierCache: F.cache, indexImages, attendu: Number(val('attendu')), basseDefinition: args.includes('--basse-definition'), deposer: (b, c, d, t) => r2.deposerBinaire(b, c, d, t), vignetter: vignetterApresJointure,
            fabriquerVerrouSet: ({ Modele, id }) => fabriquerVerrou({ Modele, id, dureeMs: 10 * 60 * 1000, surInsertion: { debute: new Date(), phase: 'plan' }, nom: `verrou de set ${id}` }) });
        console.log(`ÉCRITURE : code ${r.code} · attendu ${r.attendu} · unités à ajouter (réel) ${r.reel} · écartées ${r.ecartees} · cédées ${r.cedees} · hors cache ${r.horsCache} · altérées ${r.altere} · orphelins R2 ${r.orphelins?.length ?? 0} · REQUÊTES 0`);
        process.exitCode = r.code;
    } finally { await fermer(); }
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
