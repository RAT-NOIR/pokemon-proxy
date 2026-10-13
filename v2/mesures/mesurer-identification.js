'use strict';
// MESURE-2A — l'identification v2 mesurée de BOUT EN BOUT sur le banc réel (86 photos), avec de VRAIS appels à Gemini (OpenRouter).
//   node v2/mesures/mesurer-identification.js --instantane=<dossier> [--limite=N] [--sortie=<dossier>]
// À relancer après chaque changement du réacteur. Ce n'est pas un banc de production : il ne figure pas dans lancer-tout (qui ne prend que v2/test/test-*.js).
//
// CE QUE C'EST : la VRAIE route v2 (`traiterIdentifier`, v2/identifier/routes.js) avec ses vraies dépendances — la chaîne héritée `gererIdentifier` (index.js),
// l'appel OpenRouter/Gemini réel, le catalogue v2 (numeros_cartes + catalogue_produits + guide_prix), l'adaptateur, la règle de verdict. On ne recopie aucune décision
// et on ne rejoue aucune lecture journalisée. Les photos arrivent comme celles du scanner : des data-URL envoyées par le client (v2/scanner/routes.js, entreeDuScanner),
// jamais une URL d'annonce — la requête à Gemini part donc avec l'image elle-même.
//
// LES GARDES, écrites par ce qu'elles AUTORISENT :
//   · AUCUNE écriture en production : la base est un mongod EN MÉMOIRE ; le processus ne voit AUCUNE URI de production (verifierEnvironnement refuse de démarrer si
//     MONGODB_URI — ou n'importe quelle URI mongodb hors boucle locale — est dans l'environnement) ; les données lues viennent d'un INSTANTANÉ pris par
//     instantane-2a.js avec les seules URI de lecture ; le `.env` d'index.js (dotenv) est neutralisé par le dossier de travail.
//   · RÉSEAU : v2/mesures/garde-reseau.js n'autorise QUE openrouter.ai. TCGdex, Cardmarket, Vinted : exception, COMPTÉE (c'est une mesure : la chaîne en veut).
//   · ARGENT : chaque appel OpenRouter est compté, son coût RÉEL est lu chez le fournisseur (usage.cost de la réponse, sinon GET /generation) — jamais estimé ;
//     arrêt dur à 1,00 $ cumulés ou 250 appels ; refus de démarrer sous 2 $ de solde.
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..');
const SERVEUR = 'C:/Users/Yung/Desktop/pokemon-proxy/';                       // les vérités et les photos du banc réel (banc-identification.js l. 53-54)
const ETIQUETTES_LABO = 'C:/Users/Yung/Desktop/labo-embedding/etiquettes-66.json';
const PHOTOS_LABO = 'C:/Users/Yung/Desktop/labo-embedding/photos-66';
const PLAFOND_USD = 1.00, PLAFOND_APPELS = 250, SOLDE_MINI_USD = 2.00;

// ── Fonctions pures (jugées par le banc v2/test/test-mesurer-identification.js ou lisibles seules) ─────────────────────────────────────────────────────────────
const estUriMongo = v => typeof v === 'string' && /^mongodb(\+srv)?:\/\//i.test(v.trim());
const estBoucle = h => /^127(\.\d{1,3}){3}$/.test(h) || h === '::1' || h === '[::1]' || h.toLowerCase() === 'localhost';
function hotesDeUri(uri) {
    const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(String(uri).trim());
    return m ? m[1].split(',').map(h => h.replace(/:\d+$/, '')) : [];
}
/** Le harnais REFUSE de démarrer si MONGODB_URI est présente, ou si une variable quelconque porte une URI mongodb hors boucle locale. Ne cite jamais une VALEUR. */
function verifierEnvironnement(env = process.env) {
    if (env.MONGODB_URI !== undefined) throw new Error('🔴 MONGODB_URI est présent dans l\'environnement : cet outil ne tourne jamais avec une URI de production (retirer la variable, le processus de mesure n\'en voit aucune)');
    for (const [k, v] of Object.entries(env)) {
        if (!estUriMongo(v)) continue;
        const hotes = hotesDeUri(v);
        if (!hotes.length || !hotes.every(estBoucle)) throw new Error(`🔴 la variable ${k} porte une URI mongodb hors boucle locale : refusé (seule la base en mémoire du banc est admise)`);
    }
}
/** Intervalle de Wilson à 95 % pour k réussites sur n. */
function wilson(k, n) {
    if (!n) return { p: null, bas: null, haut: null };
    const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return { p, bas: Math.max(0, (c - m) / d), haut: Math.min(1, (c + m) / d) };
}
/** Rang nearest-rank : percentile(v, 50) = médiane (borne basse pour un effectif pair). */
function percentile(valeurs, q) {
    const v = valeurs.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return null;
    return v[Math.min(v.length - 1, Math.max(0, Math.ceil(q / 100 * v.length) - 1))];
}
const sansZeros = n => String(n ?? '').replace(/^([A-Za-z-]*)0+(\d)/, '$1$2').toUpperCase();   // banc-identification.js l. 35
// LA RÈGLE DU JUGE, recopiée MOT POUR MOT de banc-identification.js (l. 59-60) — le script ne s'importe pas : il s'exécute à l'import (IIFE) et ouvre la production.
// Seule adaptation, nommée : `(stock.porteurs.get(cle) || [])` (les porteurs d'un visuel du stock) devient `porteurs`, ici les lignes cartes_produits du produit RÉPONDU
// ({carteId, set: slugSet, numero: numeroFiche}) — l'outil n'a pas le stock de vecteurs. `impr.get(idP) || []` devient `imprVerite` (les lignes du produit vérité).
//   l. 59 : const porteImpression = (cle, idP) => (stock.porteurs.get(cle) || []).some(p => (impr.get(idP) || []).some(l => l.carteId === p.carteId && p.set === l.slugSet && (l.numeroFiche == null || p.numero == null || sansZeros(p.numero) === sansZeros(l.numeroFiche))));
//   l. 60 : const porteCarte = (cle, idP) => (stock.porteurs.get(cle) || []).some(p => (impr.get(idP) || []).some(l => l.carteId === p.carteId));
const porteImpression = (porteurs, imprVerite) => porteurs.some(p => imprVerite.some(l => l.carteId === p.carteId && p.set === l.slugSet && (l.numeroFiche == null || p.numero == null || sansZeros(p.numero) === sansZeros(l.numeroFiche))));
const porteCarte = (porteurs, imprVerite) => porteurs.some(p => imprVerite.some(l => l.carteId === p.carteId));
/** Le juge à deux niveaux : exact · même impression · même carte · faux. `lignes` : idProduct -> [{carteId, slugSet, numeroFiche}] (cartes_produits). Parité testée (banc, 5 couples réels du run D). */
function juger(reponse, verite, lignes) {
    if (reponse === verite) return 'exact';
    const porteurs = (lignes.get(reponse) || []).map(l => ({ carteId: l.carteId, set: l.slugSet, numero: l.numeroFiche })), imprVerite = lignes.get(verite) || [];
    if (porteImpression(porteurs, imprVerite)) return 'impression';
    if (porteCarte(porteurs, imprVerite)) return 'carte';
    return 'faux';
}
/** Mi2 : « l. 92 » (adaptateur.js:91-92) seulement si raison « photo-illisible » ET chaîne ambiguë à moins de 2 candidats ; toute autre sortie introuvable a sa propre classe. */
function classeIntrouvable(r) {
    const c = r.chaine;
    if (r.raison === 'photo-illisible' && c && c.ambigu === true && Number.isInteger(c.nCandidats) && c.nCandidats < 2) return `adaptateur-l92-${c.nCandidats}-candidat`;
    if (r.raison === 'photo-illisible') return c ? 'autre:photo-illisible-sans-ambigu' : 'autre:photo-illisible-sans-reponse-chaine';
    return `autre:${r.raison}`;
}

// ── Le banc réel : 86 photos (21 du testeur + 65 du labo « certain »), la définition de banc-identification.js l. 51-54 ──────────────────────────────────────────
function chargerBancReel() {
    const photos = [];
    for (const p of JSON.parse(fs.readFileSync(SERVEUR + 'photos-test/verite/propositions.json', 'utf8')))
        photos.push({ banc: 'testeur', fichier: path.join(SERVEUR, 'photos-test', p.photo + '.JPG'), nom: p.photo, idProduct: p.idProduct, titre: '' });
    for (const e of JSON.parse(fs.readFileSync(ETIQUETTES_LABO, 'utf8')).etiquettes)
        if (e.statut === 'certain') photos.push({ banc: 'labo', fichier: path.join(PHOTOS_LABO, e.photo), nom: e.ligne, idProduct: e.idProduct, titre: e.titreAnnonce || '' });
    return photos;
}

// ── Le carnet OpenRouter : compte, coût RÉEL, arrêt dur ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function creerCarnet({ axios, cle, plafondUsd = PLAFOND_USD, plafondAppels = PLAFOND_APPELS, attendre = ms => new Promise(r => setTimeout(r, ms)) }) {
    const appels = [];                                    // { scan, id, model, tokens, coutUsd, coutSource, ms, statutHttp }
    const etat = { scan: null, arret: null, coutMax: 0 };
    // Mi6 : un appel au coût INCONNU ou en ÉCHEC (il a pu être facturé : timeout) compte `coutMax` (le pire appel observé) dans le plafond, jamais 0
    const total = () => appels.reduce((t, a) => t + (a.coutUsd ?? etat.coutMax), 0);
    const estOpenRouter = u => /^https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/.test(String(u || ''));
    axios.interceptors.request.use(cfg => {
        if (!estOpenRouter(cfg.url)) return cfg;
        // l'arrêt dur : AVANT l'appel, avec la marge du pire appel observé (le coût n'est connu qu'après)
        if (appels.length >= plafondAppels) { etat.arret = `${plafondAppels} appels atteints`; const e = new Error('ARRET-BUDGET'); e.code = 'ARRET-BUDGET'; throw e; }
        if (total() + etat.coutMax > plafondUsd) { etat.arret = `${total().toFixed(4)} $ cumulés (+ pire appel ${etat.coutMax.toFixed(4)}) > ${plafondUsd} $`; const e = new Error('ARRET-BUDGET'); e.code = 'ARRET-BUDGET'; throw e; }
        cfg.__debut = Date.now();
        return cfg;
    });
    async function coutGeneration(id) {                   // le coût RÉEL chez le fournisseur : GET /generation?id=… (parfois quelques secondes de retard)
        for (let i = 0; i < 6; i++) {
            try {
                const r = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${cle}` } });
                if (r.ok) { const j = await r.json(); const c = j && j.data && (j.data.total_cost ?? j.data.usage); if (Number.isFinite(c)) return c; }
            } catch { /* on réessaie */ }
            await attendre(1500);
        }
        return null;
    }
    axios.interceptors.response.use(async rep => {
        if (!estOpenRouter(rep.config && rep.config.url)) return rep;
        const d = rep.data || {}, u = d.usage || {};
        let coutUsd = Number.isFinite(u.cost) ? u.cost : null, coutSource = coutUsd !== null ? 'usage.cost' : null;
        if (coutUsd === null && d.id) { coutUsd = await coutGeneration(d.id); coutSource = coutUsd !== null ? 'generation' : 'inconnu'; }
        appels.push({ scan: etat.scan, id: d.id || null, model: d.model || null, tokens: { entree: u.prompt_tokens ?? null, sortie: u.completion_tokens ?? null }, coutUsd, coutSource: coutSource || 'inconnu', ms: Date.now() - (rep.config.__debut || Date.now()), statutHttp: rep.status });
        if (coutUsd !== null) etat.coutMax = Math.max(etat.coutMax, coutUsd);
        return rep;
    }, err => {
        const c = err && err.config;
        if (c && estOpenRouter(c.url)) appels.push({ scan: etat.scan, id: null, model: null, tokens: null, coutUsd: null, coutSource: 'echec-cout-inconnu', ms: Date.now() - (c.__debut || Date.now()), statutHttp: err.response ? err.response.status : null });
        return Promise.reject(err);
    });
    return { appels, etat, total, definirScan: s => { etat.scan = s; } };
}

async function soldeOpenRouter(cle) {
    const r = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${cle}` } });
    if (!r.ok) throw new Error(`GET /credits : HTTP ${r.status}`);
    const j = await r.json();
    return { total: j.data.total_credits, utilise: j.data.total_usage, solde: j.data.total_credits - j.data.total_usage };
}

// ── Le chargement de l'instantané dans le mongod en mémoire ───────────────────────────────────────────────────────────────────────────────────────────────────
async function chargerInstantane(dossier, bases) {
    const readline = require('readline');
    const { EJSON } = require('bson');
    const manifeste = JSON.parse(fs.readFileSync(path.join(dossier, 'manifeste.json'), 'utf8'));
    const comptes = [];
    for (const c of manifeste.collections) {
        const coll = bases[c.base].collection(c.nom);
        const rl = readline.createInterface({ input: fs.createReadStream(path.join(dossier, `${c.base}.${c.nom}.ejson`)), crlfDelay: Infinity });
        let lot = [], n = 0;
        for await (const ligne of rl) {
            if (!ligne) continue;
            lot.push(EJSON.parse(ligne, { relaxed: false })); n++;
            if (lot.length >= 1000) { await coll.insertMany(lot, { ordered: false }); lot = []; }
        }
        if (lot.length) await coll.insertMany(lot, { ordered: false });
        const index = JSON.parse(fs.readFileSync(path.join(dossier, `${c.base}.${c.nom}.indexes.json`), 'utf8'));
        for (const i of index) {
            if (i.expireAfterSeconds !== undefined) continue;                  // un index TTL effacerait des documents dans le banc
            const { key, name, ...opts } = i;
            try { await coll.createIndex(key, { name, ...opts }); } catch (e) { console.error(`   index ${c.nom}.${name} non créé : ${String(e.message).slice(0, 80)}`); }
        }
        comptes.push({ ...c, charges: n });
        console.log(`  chargé ${(c.base + '.' + c.nom).padEnd(34)} ${String(n).padStart(8)} documents (attendu ${c.documents})`);
        if (n !== c.documents) throw new Error(`instantané incomplet : ${c.nom} ${n}/${c.documents}`);
    }
    return { manifeste, comptes };
}

/** Pourquoi une photo n'est pas affirmée, d'après ce que la chaîne héritée a RENDUE (jamais devinée). `tentatives` : appels réseau refusés par la garde pendant ce scan. */
function causeDe(s, legacy, tentatives) {
    const marque = tentatives > 0 ? '+tcgdex-bloque' : '';
    if (!legacy) return `aucune-reponse-de-la-chaine${marque}`;
    if (legacy.success === false) return `${legacy.natureRefus || 'refus'}:${legacy.motifRefus || legacy.error || 'sans-motif'}${marque}`;
    const n = Array.isArray(legacy.candidats) ? legacy.candidats.length : 0;
    if (legacy.carte && legacy.carte.ambigu === true) return `ambigue:${n}-candidat(s)${marque}`;
    return `${s.issue}${marque}`;
}
const sommaire = (corps) => {
    if (!corps || corps.success !== true || !corps.analyse) return { issue: 'panne', code: corps && corps.erreur ? corps.erreur.code : 'inconnu', reponse: null, candidats: [] };
    const c = (corps.analyse.cartes || [])[0] || {};
    const issue = { identifiee: 'affirmee', 'a-trancher': 'question', introuvable: 'introuvable' }[c.statut] || 'inconnue';
    return { issue, code: null, raison: c.raison ?? null, reponse: c.carte ? c.carte.idProduct : null, candidats: (c.candidats || []).map(x => x.idProduct) };
};

/** Les totaux, PURS (rejouables depuis les résultats bruts, sans appel). I1 : les faux affirmés se comptent et se listent sur TOUTES les photos traitées, vérité sans fiche comprise
 *  (marquées `veriteSansFiche`) ; `affirmeesHorsPerimetre` est imprimé à côté. Les issues et les décomptes de questions restent sur les photos « à fiche » (la convention du labo). */
function calculerTotaux({ resultats, brut, lignes, appelsOpenRouter = null }) {
    const traitees = resultats.filter(r => r.issue !== 'non-traitee' && !r.interrompuBudget);
    const retenues = traitees.filter(r => r.fiche);
    const retraits = {}; for (const r of resultats) { const m = r.issue === 'non-traitee' ? 'arrêt budget' : r.interrompuBudget ? 'interrompu par le budget' : !r.fiche ? 'vérité sans fiche cartes_produits' : null; if (m) retraits[m] = (retraits[m] || 0) + 1; }
    const comptage = L => { const o = {}; for (const r of L) o[r.issue] = (o[r.issue] || 0) + 1; return o; };
    const w = (k, n) => { const x = wilson(k, n); return x.p === null ? 'n/a' : `${(100 * x.p).toFixed(1)} % [${(100 * x.bas).toFixed(1)} ; ${(100 * x.haut).toFixed(1)}]`; };
    const affTout = traitees.filter(r => r.issue === 'affirmee'), aff = retenues.filter(r => r.issue === 'affirmee');
    const parNiveau = {}; for (const r of aff) parNiveau[r.niveau] = (parNiveau[r.niveau] || 0) + 1;
    const fauxProduit = affTout.filter(r => r.niveau !== 'exact'), fauxCarte = affTout.filter(r => r.niveau === 'faux');
    const nomme = r => ({ photo: r.nom, banc: r.banc, verite: r.idProduct, reponse: r.reponse, niveau: r.niveau, veriteSansFiche: !r.fiche });
    const questions = retenues.filter(r => r.issue === 'question');
    const lat = traitees.map(r => r.msTotal);
    const coutTotal = traitees.reduce((t, r) => t + (r.coutUsd ?? 0), 0), sansCout = traitees.filter(r => !r.coutConnu).length;
    const viaGemini = traitees.filter(r => r.appelsGemini >= 1).length;
    // le sous-ensemble que le blocage de TCGdex ne touche PAS (run C) : les scans où la chaîne n'a tenté AUCUN appel refusé
    const pures = retenues.filter(r => r.tcgdexOuAutreRefus.length === 0), pAff = pures.filter(r => r.issue === 'affirmee');
    const causes = {}; for (const r of retenues) if (r.causeNonAffirmee) causes[r.causeNonAffirmee] = (causes[r.causeNonAffirmee] || 0) + 1;
    // Mi2 : les introuvables, par classe (l. 92 de l'adaptateur seulement si « photo-illisible » ET ambigu à < 2 candidats)
    const intro = retenues.filter(r => r.issue === 'introuvable'), parClasse = {};
    for (const r of intro) { const k = classeIntrouvable(r); parClasse[k] = (parClasse[k] || 0) + 1; }
    const un = intro.filter(r => classeIntrouvable(r) === 'adaptateur-l92-1-candidat');
    const nivChaine = r => (r.chaine.idProduct === null ? 'sans-carte' : juger(r.chaine.idProduct, r.idProduct, lignes));
    const parNivUn = {}; for (const r of un) { const k = nivChaine(r); parNivUn[k] = (parNivUn[k] || 0) + 1; }
    const introuvables = { n: intro.length, parClasse, aUnSeulCandidat: { n: un.length, parNiveauDuCandidat: parNivUn,
        fauxCandidats: un.filter(r => nivChaine(r) === 'faux').map(r => ({ photo: r.nom, verite: r.idProduct, candidat: r.chaine.idProduct })),
        memeCarteAutreProduit: un.filter(r => nivChaine(r) === 'carte').map(r => ({ photo: r.nom, verite: r.idProduct, candidat: r.chaine.idProduct })),
        dontSansAppelRefuse: un.filter(r => r.tcgdexOuAutreRefus.length === 0).length } };
    const refusParHote = {}; for (const r of traitees) for (const h of r.tcgdexOuAutreRefus) refusParHote[h] = (refusParHote[h] || 0) + 1;
    return {
        nBrut: brut, nTraitees: traitees.length, nRetenu: retenues.length, retraits,
        issues: comptage(retenues), causesNonAffirmees: causes, introuvables,
        sousEnsembleSansAppelRefuse: { n: pures.length, issues: comptage(pures), affirmees: pAff.length, fauxProduit: pAff.filter(r => r.niveau !== 'exact').length, fauxCarte: pAff.filter(r => r.niveau === 'faux').length,
            questions: pures.filter(r => r.issue === 'question').length, veriteParmiCandidats: pures.filter(r => r.issue === 'question' && r.veriteParmiCandidats).length, wilsonAffirmees: w(pAff.length, pures.length) },
        affirmees: { n: aff.length, parNiveau, wilsonSurRetenu: w(aff.length, retenues.length) },
        affirmeesToutesTraitees: affTout.length, affirmeesHorsPerimetre: affTout.filter(r => !r.fiche).length,
        fauxAffirmesProduit: { n: fauxProduit.length, surTraitees: traitees.length, wilsonSurTraitees: w(fauxProduit.length, traitees.length), wilsonSurAffirmees: w(fauxProduit.length, affTout.length), liste: fauxProduit.map(nomme) },
        fauxAffirmesCarte: { n: fauxCarte.length, surTraitees: traitees.length, wilsonSurTraitees: w(fauxCarte.length, traitees.length), wilsonSurAffirmees: w(fauxCarte.length, affTout.length), liste: fauxCarte.map(nomme) },
        questions: { n: questions.length, veriteParmiCandidats: questions.filter(r => r.veriteParmiCandidats).length, parNombreDeCandidats: questions.reduce((o, r) => { const k = `${r.candidats.length}:${r.veriteParmiCandidats ? 'dedans' : 'hors'}`; o[k] = (o[k] || 0) + 1; return o; }, {}) },
        gemini: { appels: appelsOpenRouter ? appelsOpenRouter.length : traitees.reduce((t, r) => t + r.appelsGemini, 0), repartitionParScan: { 0: traitees.filter(r => r.appelsGemini === 0).length, 1: traitees.filter(r => r.appelsGemini === 1).length, 2: traitees.filter(r => r.appelsGemini === 2).length, plus: traitees.filter(r => r.appelsGemini > 2).length }, scansAvecAuMoinsUnAppel: viaGemini, partDesScans: `${viaGemini}/${traitees.length}` },
        latenceMs: { mediane: percentile(lat, 50), p90: percentile(lat, 90), max: percentile(lat, 100) },
        coutUsd: { total: coutTotal, moyenneParScan: traitees.length ? coutTotal / traitees.length : null, scansSansCoutLu: sansCout, sources: appelsOpenRouter ? [...new Set(appelsOpenRouter.map(a => a.coutSource))] : null },
        refusReseauParHote: refusParHote
    };
}

/** `--recalculer=<resultats.json> --instantane=<dossier>` : rejuge et recalcule les totaux depuis les résultats bruts, SANS aucun appel (ni réseau, ni base). */
function recalculer(fichier, dossierInstantane, sortie) {
    const J = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    const jug = JSON.parse(fs.readFileSync(path.join(dossierInstantane, 'jugement.json'), 'utf8'));
    const lignes = new Map(); for (const l of jug) (lignes.get(l.idProduct) || lignes.set(l.idProduct, []).get(l.idProduct)).push(l);
    const avant = JSON.stringify(J.resultats.filter(r => r.issue === 'affirmee').map(r => [r.nom, r.niveau]));
    for (const r of J.resultats) if (r.issue === 'affirmee') r.niveau = juger(r.reponse, r.idProduct, lignes);
    const totaux = { ...J.totaux, ...calculerTotaux({ resultats: J.resultats, brut: J.totaux.nBrut, lignes, appelsOpenRouter: J.appelsOpenRouter }), recalculeDepuis: path.basename(fichier), niveauxAffirmeesInchanges: avant === JSON.stringify(J.resultats.filter(r => r.issue === 'affirmee').map(r => [r.nom, r.niveau])) };
    fs.writeFileSync(sortie, JSON.stringify({ totaux, resultats: J.resultats }, null, 1));
    return totaux;
}

// ── ETIQUETAGE-B : la lecture de l'export du banc de l'administrateur (v2/mesures/exporter-banc-admin.js) et la mesure de la base « Gemini seul » = la réponse d'ORIGINE de la chaîne ─────────
const FORMAT_EXPORT_ADMIN = 'banc-admin-v1';
const erreurExport = (code, m) => Object.assign(new Error(m || code), { code });
/** Lit un export : manifeste au bon format, lignes cohérentes avec le manifeste, chaque photo nommée présente dans le dossier. Lève FORMAT ou EXPORT-INCOMPLET. */
function lireExportBancAdmin(dossier) {
    let man, lignes;
    try { man = JSON.parse(fs.readFileSync(path.join(dossier, 'manifeste.json'), 'utf8')); lignes = JSON.parse(fs.readFileSync(path.join(dossier, 'lignes.json'), 'utf8')); }
    catch { throw erreurExport('FORMAT', 'dossier sans export lisible'); }
    if (!man || man.format !== FORMAT_EXPORT_ADMIN || !Array.isArray(lignes)) throw erreurExport('FORMAT', 'format d\'export inconnu');
    if (man.lignes !== lignes.length) throw erreurExport('EXPORT-INCOMPLET', 'le manifeste annonce un autre nombre de lignes');
    for (const l of lignes) if (l.photo !== null && !(typeof l.photo === 'string' && /^photos\/[0-9a-f]{32}\.webp$/.test(l.photo) && fs.existsSync(path.join(dossier, l.photo)))) throw erreurExport('EXPORT-INCOMPLET', 'photo nommée mais absente');
    return { manifeste: man, lignes };
}
/**
 * La réponse d'ORIGINE de la chaîne (« Gemini seul ») jugée contre la vérité de l'administrateur, au niveau du PRODUIT (exacte : l'export n'a pas le catalogue des impressions).
 *  · affirmée juste : l'idProduct affirmé est la vérité ; FAUSSE : tout autre cas, la vérité « aucune » comprise ;
 *  · question qui contient la vérité : la vérité est parmi les candidats ; introuvable à bon droit : la vérité est « aucune ».
 * Chaque taux imprime son dénominateur et son intervalle de Wilson à 95 %.
 */
function mesurerGeminiSeul(lignes) {
    const n = lignes.length;
    const aff = lignes.filter(l => l.statut === 'affirmee'), q = lignes.filter(l => l.statut === 'question'), intro = lignes.filter(l => l.statut === 'introuvable');
    const juste = l => l.verite !== null && l.reponse.idProduct === l.verite;
    const justes = aff.filter(juste).length, fausses = aff.length - justes;
    const contiennent = q.filter(l => l.verite !== null && l.reponse.candidats.includes(l.verite)).length;
    const aBonDroit = intro.filter(l => l.verite === null && l.aucune).length;
    const justesOuQ = justes + contiennent;
    return {
        n, autres: lignes.filter(l => !['affirmee', 'question', 'introuvable'].includes(l.statut)).length,
        affirmees: { n: aff.length, justes, fausses, wilsonJustes: wilson(justes, aff.length) },
        fauxAffirmes: { n: fausses, sur: n, wilson: wilson(fausses, n) },
        questions: { n: q.length, contiennentLaVerite: contiennent, wilsonContiennent: wilson(contiennent, q.length) },
        introuvables: { n: intro.length, aBonDroit, manques: intro.length - aBonDroit },
        justesOuQuestionJuste: justesOuQ, wilsonJustesOuQuestionJuste: wilson(justesOuQ, n)
    };
}

async function principal() {
    const arg0 = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
    if (arg0('export')) {                                                                  // aucun appel : ni base, ni réseau, ni clé — seulement le dossier d'un export
        const e = lireExportBancAdmin(arg0('export')), m = mesurerGeminiSeul(e.lignes);
        const w = x => (x.p === null ? 'n/a' : `${(100 * x.p).toFixed(1)} % [${(100 * x.bas).toFixed(1)} ; ${(100 * x.haut).toFixed(1)}]`);
        console.log(`BANC DE L'ADMINISTRATEUR — base « Gemini seul » (réponse d'origine), ${m.n} cartes étiquetées (${e.manifeste.sansPhoto} sans photo)`);
        console.log(`  affirmées : ${m.affirmees.n} · justes ${m.affirmees.justes} (${w(m.affirmees.wilsonJustes)}) · fausses ${m.affirmees.fausses}`);
        console.log(`  faux affirmés : ${m.fauxAffirmes.n} / ${m.fauxAffirmes.sur} (${w(m.fauxAffirmes.wilson)})`);
        console.log(`  questions : ${m.questions.n} · contiennent la vérité ${m.questions.contiennentLaVerite} (${w(m.questions.wilsonContiennent)})`);
        console.log(`  introuvables : ${m.introuvables.n} · à bon droit ${m.introuvables.aBonDroit} · manqués ${m.introuvables.manques}`);
        console.log(`  affirmée juste ou question juste : ${m.justesOuQuestionJuste} / ${m.n} (${w(m.wilsonJustesOuQuestionJuste)})`);
        return;
    }
    if (arg0('recalculer')) {                                                              // aucun appel : ni base, ni réseau, ni clé
        const f = arg0('recalculer'), t = recalculer(f, arg0('instantane'), f.replace(/\.json$/, '.recalcule.json'));
        console.log(JSON.stringify(t, null, 1)); return;
    }
    verifierEnvironnement(process.env);                                                   // 1. AVANT tout require : jamais d'URI de production
    const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
    const dossierInstantane = arg('instantane');
    if (!dossierInstantane) throw new Error('--instantane=<dossier> est obligatoire');
    const sortieDossier = arg('sortie') || 'C:/Users/Yung/rat-market-travail/api/donnees-2a';
    const limite = arg('limite') ? Number(arg('limite')) : null;
    const dotenv = require('dotenv');
    const cle = dotenv.parse(fs.readFileSync(path.join(RACINE, '.env'))).OPENROUTER_API_KEY;     // la SEULE variable reprise du .env ; sa valeur n'est jamais affichée
    if (!cle) throw new Error('OPENROUTER_API_KEY absente du .env');
    process.env.OPENROUTER_API_KEY = cle;

    // 2. le dossier de travail SANS .env : le `require('dotenv').config()` d'index.js (et des modules qu'il charge) ne remettra aucune variable
    const neutre = path.join(sortieDossier, 'cwd-neutre'); fs.mkdirSync(neutre, { recursive: true });
    if (fs.existsSync(path.join(neutre, '.env'))) throw new Error('cwd-neutre contient un .env');
    process.chdir(neutre);

    // 3. la base en mémoire (AVANT la garde réseau : mongodb-memory-server peut vouloir son binaire ; il est en cache)
    const { ouvrirBanc, installerGardeEcriture } = require('../../collecte-cartes/base-banc');
    const { hotesDe } = require('../../collecte-cartes/garde-banc');
    const banc = await ouvrirBanc();
    if (banc.origine !== 'memoire') throw new Error('la base du banc n\'est pas un mongod en mémoire');
    const { installerGardeReseau } = require('./garde-reseau');
    // 4. dès ici, seul openrouter.ai sort. --autoriser-hote=api.tcgdex.net : une DÉCISION ÉCRITE (jamais le défaut) qui rouvre la lecture de TCGdex, dont la chaîne héritée dépend
    //    (sans lui, une carte correctement désignée par setCode+numéro est rangée « introuvable » : « TCGdex injoignable » est une panne). Écrit dans les totaux.
    const supplementaires = process.argv.filter(a => a.startsWith('--autoriser-hote=')).map(a => a.slice('--autoriser-hote='.length));
    const garde = installerGardeReseau({ hotesSupplementaires: supplementaires });
    process.on('uncaughtException', e => { if (e && e.code === 'GARDE-RESEAU') console.error(`⚠️ [garde] exception non gérée : ${e.message}`); else { console.error('❌', e); process.exit(1); } });
    process.on('unhandledRejection', e => { if (e && (e.code === 'GARDE-RESEAU' || e.code === 'ARRET-BUDGET')) console.error(`⚠️ [garde] rejet non géré : ${e.message}`); else { console.error('❌', e); process.exit(1); } });

    const heureDebut = new Date();
    let solde0;
    try {
        solde0 = await soldeOpenRouter(cle);
        console.log(`SOLDE OpenRouter avant : ${solde0.solde.toFixed(4)} $ (crédits ${solde0.total} · utilisé ${solde0.utilise.toFixed(4)})`);
        if (solde0.solde < SOLDE_MINI_USD) throw new Error(`solde ${solde0.solde.toFixed(2)} $ < ${SOLDE_MINI_USD} $ : on ne lance pas`);

        const mongoose = require('mongoose');
        mongoose.set('strictQuery', false);
        const hotes = hotesDe(banc.uri).join(',');
        // la base du banc, et ce que SA PROPRE garde (v2/db.js) exige : BANC_ISOLE + BANC_HOTES. MONGODB_URI reste ABSENTE ; seul le pont (pont-cartes.js) lit MONGODB_CARTES_URI.
        process.env.BANC_ISOLE = '1'; process.env.BANC_HOTES = hotes;
        process.env.MONGODB_CARTES_URI = banc.uri; process.env.MONGODB_CARTES_BASE = 'cartes';
        verifierEnvironnement(process.env);
        await mongoose.connect(banc.uri, { dbName: 'mesure_2a' });
        installerGardeEcriture(mongoose.Collection, process.env);
        const dbPrincipale = mongoose.connection.db, dbCartes = mongoose.connection.getClient().db('cartes');

        console.log(`\nCHARGEMENT de l'instantané ${dossierInstantane}`);
        const { manifeste } = await chargerInstantane(dossierInstantane, { test: dbPrincipale, cartes: dbCartes });
        const jugement = JSON.parse(fs.readFileSync(path.join(dossierInstantane, 'jugement.json'), 'utf8'));
        const lignes = new Map();
        for (const l of jugement) (lignes.get(l.idProduct) || lignes.set(l.idProduct, []).get(l.idProduct)).push(l);

        // 5. la route v2 réelle
        const db = require('../db'); db.brancher(dbPrincipale);
        const M = require('../modeles'); const J = require('../comptes/jetons');
        await M.creerIndex();
        const { lireConfig } = require('../config');
        const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
        const indexJs = require('../../index');                                           // charge dotenv (dossier neutre : rien ne revient), axios, la chaîne héritée
        verifierEnvironnement(process.env);                                               // ... et on le VÉRIFIE (le dotenv d'index.js aurait remis MONGODB_URI)
        const axios = require('axios');
        const carnet = creerCarnet({ axios, cle });
        const { assembler } = require('../index');
        let courant = null;
        const gererIdentifier = async (req, res) => {                                     // la chaîne héritée RÉELLE, observée (temps, corps rendu) sans être modifiée
            const t = Date.now(); const json0 = res.json.bind(res);
            res.json = o => { courant.legacy = o; return json0(o); };
            try { await indexJs.gererIdentifier(req, res); } finally { courant.msChaine = Date.now() - t; }
        };
        const deps = { gererIdentifier };
        assembler([require('../argent/monter'), require('../identifier/monter')], cfg, deps);   // enregistre argent / annonce / visuels / taux (comme test-identifier-v2.js)
        const { traiterIdentifier } = require('../identifier/routes');
        const route = traiterIdentifier(cfg, deps);

        const jeton = J.genererJeton();
        const inst = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 1000, libelle: 'mesure-2a' }), {});
        await db.col('installations').insertOne(inst);
        const porteur = { type: 'installation', id: inst._id, compte: null, installation: inst, surface: 'extension', administrateur: false };

        // 6. le banc réel
        let photos = chargerBancReel();
        const brut = photos.length;
        const sansFichier = photos.filter(p => !fs.existsSync(p.fichier));
        if (sansFichier.length) throw new Error(`${sansFichier.length} photo(s) introuvable(s) : ${sansFichier.slice(0, 3).map(p => p.nom).join(', ')}`);
        for (const p of photos) { p.fiche = lignes.has(p.idProduct); }
        console.log(`\nBANC RÉEL : ${brut} photos (${photos.filter(p => p.banc === 'testeur').length} du testeur sans titre · ${photos.filter(p => p.banc === 'labo').length} du labo avec titre) · vérité avec fiche cartes_produits : ${photos.filter(p => p.fiche).length}`);
        if (limite) photos = photos.slice(0, limite);

        const resultats = [];
        const refus0 = () => garde.refus().length;
        let nProcessus = null;
        for (let i = 0; i < photos.length; i++) {
            const p = photos[i];
            if (carnet.etat.arret) { resultats.push({ ...p, issue: 'non-traitee', motifRetrait: `arrêt budget : ${carnet.etat.arret}` }); continue; }
            const buf = fs.readFileSync(p.fichier);
            const type = /\.png$/i.test(p.fichier) ? 'image/png' : 'image/jpeg';
            const req = { v2: { porteur }, headers: { 'idempotency-key': `mesure2a-${Date.now().toString(36)}-${i}` }, ip: `10.2.${Math.floor(i / 250)}.${i % 250 + 1}`, body: {},
                entree: { imageUrls: [`data:${type};base64,${buf.toString('base64')}`], title: p.titre, description: '', prixVinted: null, devise: null, marche: null, vintedUrl: null, vintedEtat: null, langueInterface: 'fr', versionExtension: 'scanner' } };
            const sortie = { statut: null, corps: null };
            const res = { statut: null, status(c) { this.statut = c; return this; }, setHeader() { return this; }, json(c) { sortie.statut = this.statut; sortie.corps = c; return this; } };
            courant = { legacy: null, msChaine: null };
            carnet.definirScan(p.nom);
            const a0 = carnet.appels.length, r0 = refus0();
            const t0 = process.hrtime.bigint();
            let exception = null;
            try { await route(req, res); } catch (e) { exception = e; }
            const ms = Number(process.hrtime.bigint() - t0) / 1e6;
            const mes = carnet.appels.slice(a0), tentatives = garde.refus().slice(r0);
            const s = exception ? { issue: 'panne', code: 'EXCEPTION', reponse: null, candidats: [] } : sommaire(sortie.corps);
            const coutConnu = mes.every(a => a.coutUsd !== null);
            const rec = {
                banc: p.banc, nom: p.nom, idProduct: p.idProduct, fiche: p.fiche, titre: p.titre, issue: s.issue, code: s.code, raison: s.raison ?? null, reponse: s.reponse, candidats: s.candidats,
                niveau: s.issue === 'affirmee' ? juger(s.reponse, p.idProduct, lignes) : null,
                veriteParmiCandidats: s.issue === 'question' ? s.candidats.includes(p.idProduct) : null,
                appelsGemini: mes.length, coutUsd: coutConnu ? mes.reduce((t, a) => t + a.coutUsd, 0) : null, coutConnu, msTotal: Math.round(ms), msChaine: courant.msChaine,
                tcgdexOuAutreRefus: tentatives.map(t => t.hote), facturation: sortie.corps && sortie.corps.facturation ? sortie.corps.facturation.motif : null,
                chaine: courant.legacy ? { idProduct: courant.legacy.carte && Number.isInteger(courant.legacy.carte.idProduct) ? courant.legacy.carte.idProduct : null, success: courant.legacy.success ?? null, ambigu: Boolean(courant.legacy.carte && courant.legacy.carte.ambigu), nCandidats: Array.isArray(courant.legacy.candidats) ? courant.legacy.candidats.length : null,
                    motifRefus: courant.legacy.motifRefus ?? null, natureRefus: courant.legacy.natureRefus ?? null, erreur: typeof courant.legacy.error === 'string' ? courant.legacy.error.slice(0, 80) : null } : null,
                causeNonAffirmee: s.issue === 'affirmee' ? null : causeDe(s, courant.legacy, tentatives.length),
                exception: exception ? String(exception.code || exception.message).slice(0, 120) : null,
                interrompuBudget: Boolean(carnet.etat.arret)
            };
            resultats.push(rec);
            console.log(`${String(i + 1).padStart(2)}/${photos.length} ${p.nom.padEnd(14)} ${rec.issue.padEnd(11)}${(rec.niveau || (rec.veriteParmiCandidats === null ? '' : (rec.veriteParmiCandidats ? 'verite∈cand' : 'verite∉cand'))).padEnd(12)} gemini ${rec.appelsGemini} · ${rec.coutUsd === null ? '?' : rec.coutUsd.toFixed(5)} $ · ${rec.msTotal} ms (chaîne ${rec.msChaine}) · refus réseau ${tentatives.length}${rec.exception ? ' · EXCEPTION ' + rec.exception : ''}`);
        }

        // 7. les totaux, avec leurs dénominateurs
        const solde1 = await soldeOpenRouter(cle).catch(() => null);
        const totaux = {
            hotesAutorises: ['openrouter.ai', ...supplementaires], instantane: { debutUTC: manifeste.debutUTC, finUTC: manifeste.finUTC }, heureMesureDebut: heureDebut.toISOString(), heureMesureFin: new Date().toISOString(),
            ...calculerTotaux({ resultats, brut, lignes, appelsOpenRouter: carnet.appels }),
            solde: { avant: solde0.solde, apres: solde1 ? solde1.solde : null, ecartLuChezLeFournisseur: solde1 ? solde0.solde - solde1.solde : null }, arretBudget: carnet.etat.arret
        };
        const stamp = heureDebut.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
        const fichier = path.join(sortieDossier, `resultats-${stamp}.json`);
        fs.writeFileSync(fichier, JSON.stringify({ totaux, resultats, appelsOpenRouter: carnet.appels }, null, 1));
        console.log('\n══ TOTAUX ══\n' + JSON.stringify(totaux, null, 1));
        console.log(`\nRÉSULTATS BRUTS : ${fichier}`);
    } finally {
        garde.retirer();
        try { await require('mongoose').disconnect(); } catch { /* déjà fermé */ }
        await banc.arreter();
    }
}

module.exports = { lireExportBancAdmin, mesurerGeminiSeul, verifierEnvironnement, wilson, percentile, juger, classeIntrouvable, calculerTotaux, recalculer, chargerBancReel, creerCarnet, sommaire };

if (require.main === module) principal().then(() => process.exit(0)).catch(e => { console.error('🔴', String(e && e.message || e).replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, '<uri masquée>')); process.exit(1); });
