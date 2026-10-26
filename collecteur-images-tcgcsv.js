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
const JT = require('./collecte-cartes/tcgcsv-jointure');
const D = require('./collecte-cartes/tcgcsv-donnees');

const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\RECOLTE';
const CODE = 'tcs';
const SRC = TC.SRC;
const fichiersDe = (dossier, cache) => CLI.fichiersDe(CODE, dossier, cache);
const client = (F, plafondTotal, o = {}) => TC.fabriquerClient({ dossierCache: F.cache, plafond: HOTE.plafondRestant(F.cache, plafondTotal), journal: F.journal, ...o });
const arretDe = e => (e.plafond ? 'plafond' : e.arretDefinitif || e.bloque ? 'arret-definitif' : e.pauseHote ? 'pause-hote' : 'interrompu');

// ── 0. LE MAXIMUM du relevé (§38) : robots.txt + last-updated + catégories + 2 listes de groupes + les listes de produits à redemander ──
// Compté AVANT la première requête. Les listes de groupes ne sont connues qu'après leur lecture : tant qu'aucun relevé précédent ne les porte, les produits sont bornés par le PLAFOND (dit tel quel) ;
// ensuite par le nombre de groupes connus (au plus tous). Un jour déjà clos (une synchro par jour au plus) = 0 requête.
function maximumReleve({ F, releves = {}, plafondTotal, synchro = null, now = Date.now }) {
    const dejaAuCache = HOTE.nbCache(F.cache);
    if (synchro?.etat && TC.synchroDuJour(synchro.etat, new Date(now())).action === 'sauter-jour') return { total: 0, detail: 'jour déjà clos (une synchronisation par jour au plus) : 0 requête', secondes: 0, plafondTotal, dejaAuCache };
    const robots = HOTE.robotsFrais(F.cache, TC.HOTE_DONNEES) ? 0 : 1;           // D2 : un robots.txt de plus de 24 h se redemande
    const derniere = 1, categories = releves.categories ? 0 : 1, listes = 2;
    const fixe = robots + derniere + categories + listes;
    let produits, detailProduits;
    if (releves.listes) {
        const connus = Object.values(releves.listes).reduce((n, l) => n + l.length, 0);
        produits = connus; detailProduits = `listes de produits au plus ${connus} (tous les groupes connus ; en pratique seuls les groupes neufs ou modifiés)`;
    } else {
        produits = Math.max(0, plafondTotal - dejaAuCache - fixe); detailProduits = `listes de produits : nombre de groupes inconnu avant la lecture des listes, borné par le plafond (${produits})`;
    }
    const total = fixe + produits;
    return { total, detail: `robots.txt ${robots} + last-updated ${derniere} + catégories ${categories} + listes de groupes ${listes} + ${detailProduits}`, secondes: total * 6, plafondTotal, dejaAuCache };
}

// ── 1. LE RELEVÉ (JSON seulement) — le catalogue COMPLET (Pokémon et Pokémon Japon), synchronisation quotidienne conditionnelle ──
/**
 * @param {{cli: object, fichier: string, synchro?: {fichier: string}|null, now?: Function}} o
 *   `synchro.fichier` : derniere-synchro.json (une synchro par jour au plus ET seulement si last-updated.txt est plus récent que la dernière RÉUSSIE) ; sans lui, aucune condition (un banc).
 */
async function releve({ cli, fichier, synchro = null, now = () => new Date() }) {
    const rel = RC.lireJson(fichier, {});
    let etat = 'termine', motif = null, transitoires = 0, consecutifs = 0, lues = 0, ecritsDepuis = 0;
    const etatSynchro = synchro ? RC.lireJson(synchro.fichier, null) : null;
    const t0 = now();
    const bilan = e => ({ etat: e, motif, transitoires, requetes: cli.requetes(), requetesParHote: cli.requetesParHote(), codes: cli.codes(), lues, resume: '' });
    // 0. une synchronisation par jour au plus : décidé AVANT toute requête
    if (synchro) { const j = TC.synchroDuJour(etatSynchro, t0); if (j.action === 'sauter-jour') { motif = j.raison; return { ...bilan('deja-synchronise'), resume: j.raison }; } }
    let lastUpdated = null;
    try {
        await cli.initialiserRobots(TC.HOTE_DONNEES);
        if (synchro) {
            const lu = await cli.lire(TC.urlDerniereMaj(), { sansCache: true });
            if (lu.status !== 200) throw new Error(`last-updated.txt : HTTP ${lu.status}`);
            const d = TC.synchroApresLastUpdated(etatSynchro, lu.texte);
            if (d.action === 'refuser') { etat = 'last-updated-illisible'; motif = d.raison; }
            else if (d.action === 'rien-de-neuf') {
                RC.ecrireJson(synchro.fichier, { ...etatSynchro, verifieLe: t0.toISOString() });          // un « rien de neuf » clôt le jour
                etat = 'rien-de-neuf'; motif = d.raison;
            } else {
                lastUpdated = d.lastUpdated;
                RC.ecrireJson(synchro.fichier, { ...(etatSynchro ?? {}), reussie: false, lastUpdated, debute: t0.toISOString() });
            }
            if (etat !== 'termine') { cli.liberer?.(); return { ...bilan(etat), resume: d.raison }; }
        }
        // 1. les catégories se LISENT (l'identifiant du Japon ne se devine pas)
        if (!rel.categories) {
            const c = await cli.lire(TC.urlCategories());
            if (c.status !== 200) throw new Error(`liste des catégories : HTTP ${c.status}`);
            rel.categories = TC.resoudreCategories(c.texte); lues++;
        }
        const admises = [rel.categories.pokemon, rel.categories.japon];
        // 2. les listes de groupes (jamais depuis le cache : `modifiedOn` change)
        rel.listes = rel.listes ?? {};
        const nouvelles = {};
        for (const cat of admises) {
            const g = await cli.lire(TC.urlGroupes(cat, admises), { sansCache: true });
            if (g.status !== 200) throw new Error(`liste des groupes (catégorie ${cat}) : HTTP ${g.status}`);
            const j = JSON.parse(g.texte);
            if (!j || j.success !== true || !Array.isArray(j.results) || !j.results.length) throw new Error(`liste des groupes (catégorie ${cat}) illisible ou vide`);
            nouvelles[cat] = j.results.map(x => ({ groupId: x.groupId, name: x.name, abbreviation: x.abbreviation ?? null, publishedOn: x.publishedOn ?? null, modifiedOn: x.modifiedOn ?? null, categoryId: x.categoryId ?? cat, isSupplemental: x.isSupplemental ?? null }));
            if (cat === rel.categories.pokemon) {
                try { rel.groupes = { le: g.le, ...TC.verifierGroupes(g.texte) }; }       // la table PP / kit : un groupe renommé n'arrête PAS le catalogue complet, il est écrit et le plan refuse ces groupes
                catch (e) { rel.groupes = { le: g.le, groupes: j.results.length, erreurVerification: e.message }; }
            }
            lues++;
        }
        rel.listes = nouvelles;
        // 3. les listes de produits : jamais relevées ou modifiées depuis
        const par = new Map(Object.values(nouvelles).flat().map(g => [g.groupId, g]));
        for (const q of TC.groupesARedemander({ listes: nouvelles, rel })) {
            const g = par.get(q.groupId);
            let r;
            try { r = await cli.lire(TC.urlProduits(q.categoryId, q.groupId, admises), { reduire: TC.reduireProduits, sansCache: q.sansCache }); }
            catch (e) {
                if (!e.transitoire) throw e;
                transitoires++;
                if (++consecutifs >= 2) { etat = 'serveur-indisponible'; motif = `deux erreurs serveur de suite (${e.message})`; break; }
                continue;
            }
            consecutifs = 0; lues++;
            if (r.status !== 200) { rel[q.groupId] = { nom: g.name, categoryId: q.categoryId, modifiedOn: g.modifiedOn, absente: true, le: r.le }; continue; }
            const j = JSON.parse(TC.reduireProduits(r.texte));          // le cache peut porter la liste entière (une sonde) ou réduite : la même forme dans les deux cas
            if (!j.results.every(p => p.groupId === q.groupId)) throw new Error(`le groupe ${q.groupId} rend des produits d'un autre groupe — on ne lit pas`);
            rel[q.groupId] = { nom: g.name, categoryId: q.categoryId, modifiedOn: g.modifiedOn, le: r.le, produits: j.results };
            if (++ecritsDepuis % 25 === 0) RC.ecrireJson(fichier, rel);          // le cache garde tout : une coupure ne coûte aucune requête
        }
    } catch (e) { etat = arretDe(e); motif = e.message; }
    RC.ecrireJson(fichier, rel);
    cli.liberer?.();                      // D3 : le verrou de l'hôte est rendu
    const restants = rel.listes ? TC.groupesARedemander({ listes: rel.listes, rel }).length : null;
    const total = rel.listes ? Object.values(rel.listes).reduce((n, l) => n + l.length, 0) : 0;
    if (synchro && lastUpdated) {
        const reussie = etat === 'termine' && restants === 0;
        RC.ecrireJson(synchro.fichier, { reussie, lastUpdated, ...(reussie ? { syncLe: t0.toISOString(), verifieLe: t0.toISOString() } : { verifieLe: etatSynchro?.verifieLe ?? null, interrompuLe: now().toISOString(), motif }), groupes: total, restants });
    }
    return { ...bilan(etat), resume: `groupes ${total - (restants ?? total)}/${total} relevés · catégories ${rel.categories ? JSON.stringify(rel.categories) : 'non lues'} · liste PP/kit ${rel.groupes ? (rel.groupes.erreurVerification ? 'ERREUR' : 'vérifiée') : 'non lue'} · à redemander ${restants ?? '?'}` };
}

// ── 2. LE PLAN ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Le catalogue COMPLET (T4) : la table mesurée, la jointure, les unités. `cm` (données Cardmarket assemblées) vient de l'appelant, ou de la production en LECTURE SEULE (`prod`) ; sans l'un ni l'autre : dit, pas deviné. */
async function planCatalogue({ db, prod, releves, cm, minCommuns }) {
    if (!releves?.listes || !releves?.categories) return { etat: 'releve-incomplet', raison: 'le relevé ne porte ni catégories ni listes de groupes (--releve du catalogue complet pas fait)', unites: [] };
    let donnees = cm ?? null;
    if (!donnees && prod) donnees = D.assemblerCm(await D.lireCmDepuisBase({ cartes: { db } }, prod));
    if (!donnees) return { etat: 'cm-absent', raison: 'les produits Cardmarket (numéros, noms : base de production, lecture seule) ne sont pas fournis — la jointure générale ne se devine pas', unites: [] };
    const pc = JT.planifierCatalogue({ rel: releves, cm: donnees, exclureGroupes: new Set(TC.GROUPES.map(g => g.groupId)), ...(minCommuns ? { minCommuns } : {}) });
    return { etat: 'planifie', ...pc.resume, denominateursCm: donnees.denominateurs, nonAppariees: pc.table.resume.nonAppariees.length, unites: pc.unites, restes: pc.restes, nonJoints: pc.nonJoints };
}
async function construirePlan({ db, prod = null, releves, dossierArrets = RH.DOSSIER_PAUSES, cm = null, minCommuns = null }) {
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
    const cat = await planCatalogue({ db, prod, releves, cm, minCommuns });
    if (cat.etat === 'planifie') {
        unites.push(...cat.unites);
        for (const x of cat.restes) restes.push({ code: 'CATALOGUE', ...x });
        parGroupe.push({ code: 'CATALOGUE', etat: 'planifie', famille: 'catalogue', unites: cat.unites.length, restes: cat.restesParMotif, base: { groupes: cat.groupes, produitsJoints: cat.produitsJoints } });
    }
    const decidees = (await RC.decider(SRC, unites, RC.lecteurNatif(db))).map(u => (u.ecrivable === false
        // le visuel d'un tirage dont la langue n'est pas ouverte à l'écriture pour cette source (le japonais) : téléchargeable (preuve lue), JAMAIS écrit
        ? { ...u, decision: { action: 'cede', raison: `langue ${u.langue} : l'écriture n'est pas ouverte pour cette source (seul l'anglais l'est)`, remplace: [] } } : u));
    const decisions = {};
    for (const u of decidees) { const k = `${u.groupe}:${u.decision.action}`; decisions[k] = (decisions[k] || 0) + 1; }
    const aAjouter = decidees.filter(u => u.decision.action === 'ajouter');
    const imagesFermees = arret ? { fermees: true, hote: TC.HOTE_IMAGES, nature: arret.nature ?? null, le: arret.le ?? null, motif: arret.motif ?? null, illisible: !!arret.illisible } : { fermees: false };
    const resume = { le: new Date().toISOString(), source: SRC.SOURCE, lot: SRC.LOT, imagesFermees, parGroupe, unitesProuvees: unites.length, decisions, aAjouter: aAjouter.length, dontRemplacentUneBasseDefinition: aAjouter.filter(u => u.decision.remplace.length).length,
        catalogue: { etat: cat.etat, ...(cat.raison ? { raison: cat.raison } : {}), ...(cat.etat === 'planifie' ? { groupes: cat.groupes, parStatutTable: cat.parStatutTable, nonAppariees: cat.nonAppariees, produitsJoints: cat.produitsJoints, unites: cat.unites.length, restesParMotif: cat.restesParMotif, denominateursCm: cat.denominateursCm, nonEcrivables: cat.unites.filter(u => u.ecrivable === false).length } : {}) },
        restesParMotif: restes.reduce((m, r) => (m[r.motif] = (m[r.motif] || 0) + 1, m), {}),
        note: imagesFermees.fermees ? 'IMAGES FERMÉES : ces unités sont ce que la source PROUVERAIT ; aucune image n\'est téléchargeable tant que l\'arrêt durable de l\'hôte des images tient (seul le coordinateur le lève).' : 'images ouvertes' };
    return { resume, unites: decidees, restes, nonJoints: cat.nonJoints ?? [] };
}

// ── 3. LE MANIFESTE DE LECTURE (règle « preuve lue, source unique ») ────────────────────────────────────────────────────────
/**
 * Les produits JOINTS dont l'image est au cache -> `preuves.json` au format de la phase 4, champs `lu` VIDES : l'image est LUE ensuite par un humain / un agent qui la regarde (jamais par ce code), puis validée par le
 * coordinateur. Une image absente du cache n'est ni inventée ni un trou : comptée. Le japonais figure au manifeste (la lecture sert de preuve) alors que l'écriture lui reste fermée.
 */
async function manifeste({ unites, indexImages, dossierCache, dossier }) {
    const entrees = []; let sansImage = 0; const parGroupe = {};
    const vus = new Set();
    for (const u of unites) {
        const ix = indexImages[u.url], c = ix && ['ok', 'trop-petit'].includes(ix.statut) ? HOTE.lireDuCache(dossierCache, u.url) : null;
        if (!c) { sansImage++; continue; }
        const id = u.produits[0];
        if (vus.has(id)) continue;
        vus.add(id);
        const fichier = path.join(dossierCache, HOTE.nomCache(u.url)).replace(/\.json$/, '.bin');
        entrees.push({ idProduct: id, regle: 'preuve-lue', url: u.url, hote: TC.HOTE_IMAGES, fichier, sha256: ix.sha256 ?? c.meta?.sha256 ?? null, w: ix.w ?? null, h: ix.h ?? null, seconde: null,
            attendu: { nom: u.carteNom ?? null, numero: u.numero ?? null, langue: u.langue ?? SRC.LANGUE, tampon: SRC.tampon(u.slugSet) ?? null, variante: (/-(V\d+)-/i.exec(u.slugProduit ?? '') || [])[1]?.toUpperCase() ?? null },
            lu: { nom: '', numero: '', total: '', langue: '', tampon: null, finition: '', marques: [], note: '' }, varianteNommee: null, contradictions: [], sourcesConsultees: ['tcgcsv (catalogue du marché TCGplayer)'], luLe: null,
            jointure: { productId: u.idSource, nomSource: u.nomSource, numeroSource: u.numeroSource, niveau: u.niveau ?? null, groupeMarche: u.groupeMarche ?? null, famille: u.groupe, statutImage: ix.statut } });
        parGroupe[u.groupe] = (parGroupe[u.groupe] || 0) + 1;
    }
    const fichier = path.join(dossier, 'preuves.json');
    RC.ecrireJson(fichier, { famille: 'TCGCSV', le: new Date().toISOString(), entrees, trous: [] });
    return { fichier, entrees: entrees.length, sansImage, parGroupe };
}

// T4 : l'état de la synchro quotidienne vit à côté du relevé (derniere-synchro.json, dans le dossier de sorties) ; la ligne de commande donne le dossier.
const fichierSynchro = dossier => path.join(dossier, 'derniere-synchro.json');
/** La synchro quotidienne conditionnelle, appelable par le comblement nocturne (comblement.synchroniserFournisseurs) avant le plan : last-updated.txt contre la dernière synchro réussie, une seule par jour, le maximum imprimé avant la première requête. */
async function synchroniser({ dossier = DOSSIER, plafond = 2000, journal = m => console.log(m), cliDe = client } = {}) {
    const F = fichiersDe(dossier);
    const m = maximumReleve({ F, releves: RC.lireJson(F.releves, {}), plafondTotal: plafond, synchro: { etat: RC.lireJson(fichierSynchro(dossier), null) } });
    journal(`MAXIMUM de la synchro tcs : ${m.total} requête(s) (${m.detail}) · plafond total ${plafond}`);
    if (m.total === 0) return { etat: 'deja-synchronise', requetes: 0, motif: m.detail };
    return releve({ cli: cliDe(F, plafond), fichier: F.releves, synchro: { fichier: fichierSynchro(dossier) } });
}
const def = { CODE, SRC, DOSSIER, hoteImages: TC.HOTE_IMAGES, hotesLibelle: `hôtes ${TC.HOTE_DONNEES} (données) et ${TC.HOTE_IMAGES} (images)`, clientDe: client,
    // les unités à télécharger : celles à ajouter ET les visuels non écrivables (japonais) dont la lecture sert de preuve ; jamais les autres
    avecProduction: true, manifeste, synchronise: () => synchroniser(),
    aTelecharger: plan => plan.unites.filter(u => u.decision?.action === 'ajouter' || u.ecrivable === false),
    maximumReleve: o => maximumReleve({ ...o, synchro: o.synchro ?? (o.dossier ? { etat: RC.lireJson(fichierSynchro(o.dossier), null) } : null) }),
    releve: o => releve({ ...o, synchro: o.synchro ?? (o.dossier ? { fichier: fichierSynchro(o.dossier) } : null) }), construirePlan };
if (require.main !== module) { module.exports = { synchroniser, manifeste, planCatalogue, maximumReleve, maximumImages: CLI.maximumImages, releve, construirePlan, fichiersDe, client, def, DOSSIER, CODE }; return; }
// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
CLI.lancer(def);
