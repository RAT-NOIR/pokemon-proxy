'use strict';
// SERIE-ESSAI (25/10) — rejoue une SÉRIE de scans des bancs sur le SERVICE D'ESSAI (POST /api/photo, puis POST /api/identifier avec photoIds, empreintes de nav-bancs.json et modeleEmpreinte), mesure la durée de chaque scan
// (n, p50, p95) et compare les « sûrs » rendus par l'essai à ceux de la mesure locale sur les MÊMES lignes.
// ⚠️ ÉCRIT POUR ÊTRE LANCÉ PAR LE TESTEUR OU L'AGENT API, JAMAIS PAR UN BANC : un banc n'importe que les fonctions pures et injecte un faux `fetch`. Chaque scan est un appel au modèle payant côté essai : d'où le carnet et le plafond.
// Ce que le client s'interdit, écrit par ce qu'il AUTORISE :
//   · UN seul hôte : `rat-market-api-essai.onrender.com`, en https, sans identifiant, sans port, sans suivre une redirection (un autre hôte, ou une redirection vers lui : refus, avant toute requête) ;
//   · le jeton Bearer vient de la CONNEXION NORMALE de l'API, avec le compte de mesure (v2/admin/compte-essai.js --banc) : V2_ESSAI_BANC_IDENTIFIANT et V2_ESSAI_BANC_MOT_DE_PASSE (process.env, sinon le fichier d'environnement
//     donné par --env=), jamais imprimés ni écrits ; si l'un manque, arrêt AVANT toute requête. Le chemin : POST /api/installation (jeton d'installation) → POST /api/compte/connexion (cookie de session, en-têtes du site) →
//     POST /api/compte/code → POST /api/compte/lier (le jeton d'installation lié au compte administrateur). Ses scans sont marqués « banc » au journal du service ;
//   · un plafond de dépense DUR (--plafond-usd=, obligatoire) tenu dans un carnet sur disque (--carnet=, une ligne JSON par scan, écrite avant le scan suivant) : le total déjà inscrit au carnet COMPTE (le plafond vaut pour la
//     somme de toutes les séries du même carnet) ; avant chaque scan, si total + coût estimé dépasse le plafond, la série s'ARRÊTE (jamais un scan « qui passe juste ») ;
//   · MODE DEUX TEMPS (--deuxieme-apres-signal=<fichier> --sortie2=<rapport2.json> [--attente-max-min=120]) : /api/installation est limitée à 2 par IP et par 24 h, donc DEUX séries sur les mêmes lignes (règle d'image seule, puis avec G après un changement de variable
//     et un redéploiement) se jouent dans UN SEUL processus, avec UNE connexion. Après la série 1 (sortie écrite dans --sortie), le client attend que le fichier EXISTE (vérifié toutes les 30 s, ligne d'état « en attente du signal », sans valeur secrète), refait /ping,
//     puis rejoue les MÊMES lignes dans le même ordre avec le même jeton, gardé EN MÉMOIRE (jamais écrit : ni disque, ni carnet, ni journal). Le plafond couvre les deux séries au même carnet. Jeton refusé (401) au début de la série 2 : arrêt propre. Série 1 arrêtée : pas de série 2 ;
//   · le corps de /api/identifier est celui du CONTRAT 2 : `contrat: 2` (sans lui l'aiguilleur renvoie vers la route héritée : 401), title, description, prixVinted, devise, langueInterface ; le banc le juge par `verifierEntree` de la production ;
//   · GARDE ANTI-VINTED : l'adresse d'image de l'annonce est factice (exigée par la forme) ; un scan ne compte que si `analyse.photoRecue === true`. Sinon (champ absent, faux, pas d'`analyse`) la série S'ARRÊTE à l'instant : le serveur a pu télécharger l'adresse chez Vinted ;
//   · le carnet porte, en plus de l'estimation, une ligne « résultat » par scan (statut HTTP, analyse présente, photo rattachée), sans coût ;
//   · une série se rejoue à l'identique : l'échantillon est tiré d'une graine écrite (--graine=) sur les lignes triées par clé, dans cet ordre-là ;
//   · MODE --g-probable (31/10, ordre n°12) : le client fait ce que fait l'extension >= 2.0.1 : il annonce `versionExtension` 2.0.1 et `capacitesClient: ['mesures-1']` ; quand la réponse est une QUESTION portant un `complement`, il produit les
//     mesures demandées avec les fonctions de PRODUCTION (serie-probable.js::produireMesures : ratmarket/zones.js, carte-redressee.js, validerResultats) sur la carte redressée (--cartes=) et les visuels de référence LOCAUX (--scans=, lecture seule),
//     puis POST /api/identifier/mesures avec `accepteProbable: true`. Chaque verdict est JUGÉ contre la vérité du banc (sûr juste/FAUX, probable juste/FAUX, question) ; le client DÉCLARE (confirmation d'un probable juste, la vérité parmi les
//     candidats, « aucune » sinon ; --sans-declarations les coupe) ; ARRÊT IMMÉDIAT au premier probable FAUX ou sûr FAUX, avant le scan suivant (code de sortie 10 / 11, ligne fautive au carnet et au rapport). Il ne touche à AUCUNE variable
//     du service. Sans l'option, rien de ce qui précède n'existe : le client est celui d'avant, octet pour octet (banc test-serie-essai.js).
//   · MODE --compte=ordinaire (01/11, COMPTE-TEST) : la série des 9 lignes du compte de test ORDINAIRE (serie-compte-test.js::TABLEAU, §7 de serie-P-verifications.md) — débits, remboursements « aucune », plafond `probable-aucune`, introuvable. Les
//     identifiants sont l'AUTRE couple (V2_ESSAI_ORDINAIRE_IDENTIFIANT / _MOT_DE_PASSE) ; le client suit EXACTEMENT le chemin d'un client réel de l'extension 2.0.1 : il annonce la version 2.0.1 et `capacitesClient: ['mesures-1']`, et quand le serveur propose un complément il fait le second envoi /api/identifier/mesures avec le code de --g-probable (secondEnvoiDesMesures : mesures de production, références de l'hôte R2 public, `--cartes=` exigé) — sans appel de plus au modèle payant. Le SEUL écart permis : la photo est déposée par /api/photo au lieu d'être téléchargée chez Vinted. Pour chaque ligne il inscrit au carnet la facturation
//     servie, le solde (offre) avant et après (POST /api/solde, lecture pure) et la déclaration envoyée, les compare à la ligne du TABLEAU et s'ARRÊTE au premier écart (code 14) ; un compte ordinaire ne peut pas déposer de photo (POST /api/photo est réservée à
//     l'administrateur) : tout refus de dépôt arrête la série AVANT /api/identifier (code 15), jamais de retombée sur l'adresse de l'annonce. Les lignes viennent du tableau (--cles, --n, --graine, --g-probable, --sans-declarations sont refusés).
// Usage : node v2/mesures/serie-essai.js --resultats=<resultats-*.json> --nav=<nav-bancs.json> --photos=<dossier des photos des bancs, <clé de photo>.jpg|png|webp> --n=<N> --graine=<entier> --plafond-usd=<USD> --carnet=<fichier.jsonl>
//         [--compte=ordinaire  (les 9 lignes du tableau du compte de test : ni --n, ni --graine, ni --cles, ni --g-probable)]
//         [--cartes=<dossier des cartes redressées, <clé de photo>.jpg>] [--g-probable [--scans=<dossier>,<dossier>] [--tampons=<json>] [--version-extension=2.0.1] [--sans-declarations]] [--cles-avec-verite-seulement  (ne tire que des lignes qui ont une vérité : un sûr n'y reste jamais non jugé)] [--eteindre-si-sur-faux=V2_PROMOTION_SURS --commit-essai=<commit>  (un sûr FAUX arrête la série, pose la variable à 0 sur l'essai par render/poser-variables-essai.js, journalise l'heure et la ligne ; code de sortie 12)] [--env=<fichier .env>] [--pause-s=6] [--cout-estime-usd=0.0037] [--modele-id=… --modele-sha256=…] [--sortie=<rapport.json>] [--base=https://rat-market-api-essai.onrender.com]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SP = require('./serie-probable');
const CT = require('./serie-compte-test');

// JUGE EN UN CLIC (ordre n°30) : l'hôte, la lecture des identifiants, l'appel HTTP et le chemin de connexion vivent dans connexion-essai.js, importé aussi par le lanceur du juge (aucune recopie).
const { Arret, HOTE_ESSAI, ORIGINE_SITE, NOM_IDENTIFIANT, NOM_MOT_DE_PASSE, NOM_ORDINAIRE_IDENTIFIANT, NOM_ORDINAIRE_MOT_DE_PASSE, DELAI_MS, baseAutorisee, lireVariable, lireIdentifiants, creerAppelant, connexionNormale } = require('./connexion-essai');

const CODE_EXTINCTION = 12;                                               // la série s'est arrêtée sur un sûr FAUX et a éteint la variable (voir decisionExtinction)
const MODELE_DEFAUT = Object.freeze({ id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' });
const COUT_ESTIME_DEFAUT_USD = 0.0037;                                   // mesuré : une identification de production, 2 photos, médiane du journal (CLAUDE.md §73)
const IMAGE_ANNONCE = 'https://images1.vinted.net/t/serie-essai/f800/serie-essai.jpeg';   // exigée par la forme de la requête ; jamais téléchargée par le serveur quand un photoId est reçu
const TYPES = Object.freeze({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' });
const ERREURS_DE_SUITE_MAX = 3;

// ── EXTINCTION AUTOMATIQUE (DECISION-SURS, 01/11) : `--eteindre-si-sur-faux=<VARIABLE> --commit-essai=<commit>`. Dès qu'une ligne rend un SÛR dont le produit n'est pas la vérité, la série s'arrête, la variable est posée à 0 sur
// l'ESSAI par l'outil existant (render/poser-variables-essai.js : sauvegarde chiffrée, essai à blanc, relecture, déploiement de --attendu=, restauration si échec), et l'heure et la ligne sont journalisées. Jamais la production.
// 🔑 Écrit par ce qu'il AUTORISE : une seule variable est éteignable (V2_PROMOTION_SURS) ; la décision est PURE ; l'appel réel à Render est INJECTÉ (deps.eteindre), jamais lancé par un banc.
const VARIABLES_EXTINCTION = Object.freeze(['V2_PROMOTION_SURS']);
const OUTIL_VARIABLES_ESSAI = 'C:\\Users\\Yung\\rat-market-travail\\api\\render\\poser-variables-essai.js';
const COMMIT_ESSAI = /^[0-9a-f]{8,}$/;
/**
 * La décision PURE « sûr faux => éteindre ». @param observations [{ sur: boolean, produit }] ce que la ligne a rendu (la première réponse, et le verdict final d'un second envoi) ; @param verite l'idProduct de la vérité du banc
 * @returns { eteindre: boolean, raison: string } — vrai SEULEMENT si la variable est éteignable, la vérité connue (entier) et qu'une observation est un SÛR dont le produit n'est pas la vérité. Sans vérité : jamais (rien ne se juge).
 */
function decisionExtinction({ variable, observations, verite } = {}) {
    const non = raison => ({ eteindre: false, raison });
    if (!VARIABLES_EXTINCTION.includes(variable)) return non('variable non éteignable');
    if (!Number.isInteger(verite)) return non('vérité inconnue : rien ne se juge');
    const faux = (Array.isArray(observations) ? observations : []).find(x => x && x.sur === true && x.produit !== verite);
    return faux ? { eteindre: true, raison: `sûr FAUX : produit ${faux.produit}, vérité ${verite}` } : non('aucun sûr faux');
}
/** L'exécution réelle : pose `<variable>=0` sur l'essai par poser-variables-essai.js (--appliquer --attendu=<commit>). Le spawn est injectable ; jamais appelée par un banc. @returns { ok, statut } */
function eteindreSurRender({ variable, commit }, deps = {}) {
    if (!VARIABLES_EXTINCTION.includes(variable) || !COMMIT_ESSAI.test(String(commit))) return { ok: false, statut: null, erreur: 'variable ou commit refusé' };
    const spec = path.join(require('os').tmpdir(), `eteindre-${variable}-${Date.now()}.json`);
    fs.writeFileSync(spec, JSON.stringify({ [variable]: { valeur: '0' } }));
    try {
        const r = (deps.spawn || require('child_process').spawnSync)(process.execPath, [deps.outil || OUTIL_VARIABLES_ESSAI, spec, '--appliquer', `--attendu=${commit}`], { encoding: 'utf8', timeout: 25 * 60000 });
        return { ok: r.status === 0, statut: r.status };
    } finally { try { fs.unlinkSync(spec); } catch { /* spécification déjà retirée */ } }
}

/** Un PRNG à graine (mulberry32) : la même graine rend la même suite. */
function aleatoire(graine) {
    let a = (graine >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** L'échantillon : les lignes TRIÉES par clé, mélangées (Fisher-Yates) par la graine, les n premières. Mêmes lignes, même ordre, à chaque rejeu. */
function echantillon(lignes, n, graine) {
    if (!Number.isInteger(n) || n < 1) throw new Arret('--n doit être un entier >= 1');
    if (!Number.isInteger(graine)) throw new Arret('--graine doit être un entier (écrite dans le carnet)');
    const l = [...lignes].sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
    const r = aleatoire(graine);
    for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
    return l.slice(0, n);
}

/** Rang nearest-rank : p50 / p95 d'une liste de durées (ms). null si la liste est vide. */
function quantile(valeurs, q) {
    if (!valeurs.length) return null;
    const s = [...valeurs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}
const statistiques = durees => ({ n: durees.length, p50: quantile(durees, 0.5), p95: quantile(durees, 0.95) });

/** Le carnet de dépense : une ligne JSON par scan, ajoutée AVANT le scan suivant. Le total déjà inscrit compte. */
function ouvrirCarnet(fichier, { plafondUsd, coutEstimeUsd }) {
    if (!(typeof plafondUsd === 'number' && Number.isFinite(plafondUsd) && plafondUsd > 0)) throw new Arret('--plafond-usd obligatoire (un nombre > 0) : pas de série sans plafond');
    if (!fichier) throw new Arret('--carnet obligatoire');
    let total = 0;
    if (fs.existsSync(fichier)) {
        for (const l of fs.readFileSync(fichier, 'utf8').split(/\r?\n/)) {
            if (!l.trim()) continue;
            let o; try { o = JSON.parse(l); } catch { throw new Arret('carnet illisible : une ligne n\'est pas du JSON (rien n\'est lancé)'); }
            if (o && typeof o.coutUsd === 'number' && Number.isFinite(o.coutUsd)) total += o.coutUsd;
        }
    }
    return {
        total: () => total,
        /** true seulement si le scan à venir tient SOUS le plafond. */
        peutDepenser: () => total + coutEstimeUsd <= plafondUsd + 1e-12,
        inscrire(entree) {
            const cout = coutEstimeUsd;
            fs.appendFileSync(fichier, JSON.stringify({ ...entree, coutUsd: cout, totalApresUsd: Math.round((total + cout) * 1e6) / 1e6, plafondUsd }) + '\n');
            total += cout;
        },
        /** Une ligne « résultat » (statut HTTP, analyse présente, photo rattachée) : sans coût, elle n'ajoute rien à la dépense. */
        noter(entree) { fs.appendFileSync(fichier, JSON.stringify(entree) + '\n'); }
    };
}

const produitDe = s => { const m = /^sûr (\d+)/.exec(String(s || '')); return m ? Number(m[1]) : null; };
/** Les lignes locales (résultats d'un banc) : { cle, verite, localSur, localProduit }, la variante LIVRÉ rejouée comme mesurer-sur-par-image.js. */
function lignesLocales(R) {
    const LIVRE = Object.keys(R.bancs || {}).find(k => /LIVRÉ/.test(k));
    const apres = new Map(((LIVRE && R.diffs && R.diffs[LIVRE]) || []).map(x => [x.cle, x.apres]));
    return (R.ref || []).filter(x => x.banc !== 'hors-banc').map(x => {
        const brut = apres.has(x.cle) ? apres.get(x.cle) : null;
        const sur = brut !== null ? produitDe(brut) !== null : (x.et && x.et.type === 'sur');
        const produit = brut !== null ? produitDe(brut) : (x.et && x.et.type === 'sur' ? (x.et.produit ?? x.et.idProduct ?? null) : null);
        return { cle: x.cle, banc: x.banc, verite: x.verite ?? null, localSur: sur, localProduit: produit };
    });
}

/** La réponse d'essai → { sur, produit }. « Sûr » = la première carte est `identifiee` (statut fermé du contrat), jamais une question ni un refus. */
function sureDe(reponse) {
    const c = reponse && reponse.analyse && Array.isArray(reponse.analyse.cartes) ? reponse.analyse.cartes[0] : null;
    const ok = Boolean(c && c.statut === 'identifiee' && c.carte && Number.isInteger(c.carte.idProduct));
    return { sur: ok, produit: ok ? c.carte.idProduct : null };
}

/** La comparaison essai / local sur les mêmes lignes (celles dont l'essai a rendu une réponse). */
function comparer(resultats) {
    const c = { lignes: resultats.length, essaiSur: 0, localSur: 0, lesDeux: 0, memeProduit: 0, essaiSeul: 0, localSeul: 0, fauxEssai: 0, fauxLocal: 0, sansVerite: 0 };
    for (const r of resultats) {
        if (r.essaiSur) c.essaiSur++;
        if (r.localSur) c.localSur++;
        if (r.essaiSur && r.localSur) { c.lesDeux++; if (r.essaiProduit === r.localProduit) c.memeProduit++; }
        else if (r.essaiSur) c.essaiSeul++;
        else if (r.localSur) c.localSeul++;
        if (r.verite === null || r.verite === undefined) { c.sansVerite++; continue; }
        if (r.essaiSur && r.essaiProduit !== r.verite) c.fauxEssai++;
        if (r.localSur && r.localProduit !== r.verite) c.fauxLocal++;
    }
    return c;
}

function trouverFichier(dossier, cle) {
    for (const ext of Object.keys(TYPES)) { const f = path.join(dossier, cle + ext); if (fs.existsSync(f)) return { fichier: f, type: TYPES[ext] }; }
    return null;
}
const clePhoto = cle => String(cle).split(':')[0];

/**
 * La série. `deps.fetch` : injectable (le banc passe un faux serveur) ; `deps.horloge` : () => ms ; `deps.pause` : ms => Promise ; `deps.log`. Ne lance rien tant que la configuration n'est pas jugée entièrement.
 * Rend { arret, resultats, durees, stats, comparaison, depenseUsd } — jamais le jeton.
 */
async function serie(o, deps = {}) {
    const fetchF = deps.fetch || globalThis.fetch, horloge = deps.horloge || (() => Number(process.hrtime.bigint() / 1000000n)), pause = deps.pause || (ms => new Promise(r => setTimeout(r, ms))), log = deps.log || console.log;
    // ── tout est jugé AVANT la première requête ──
    const base = baseAutorisee(o.base || `https://${HOTE_ESSAI}`);
    // MODE --compte=ordinaire : tout ce qui ne va pas avec lui est refusé AVANT la première requête (une garde écrite par ce qu'elle AUTORISE : un seul mode compte, et il ne se combine avec rien qui ferait un second envoi ou un autre échantillon)
    const ct = o.compte === 'ordinaire';
    if (o.compte !== undefined && o.compte !== null && !ct) throw new Arret('--compte n\'admet que la valeur « ordinaire »');
    if (ct) {
        if (o.gProbable === true) throw new Arret('--compte=ordinaire ne se combine pas avec --g-probable (aucun second envoi de mesures)');
        if (o.deuxiemeApresSignal) throw new Arret('--compte=ordinaire ne se combine pas avec --deuxieme-apres-signal');
        if (o.declarations === false) throw new Arret('--compte=ordinaire ne se combine pas avec --sans-declarations (les déclarations sont ce qu\'il mesure)');
        if (o.cles !== undefined && o.cles !== null) throw new Arret('--compte=ordinaire ne se combine pas avec --cles (les 9 lignes sont celles du tableau)');
        // --n et --graine : la ligne de commande rend NaN quand ils sont absents ; un nombre est une demande d'échantillon, que le tableau exclut
        if (o.n !== undefined && o.n !== null && !Number.isNaN(o.n)) throw new Arret('--compte=ordinaire ne se combine pas avec --n (les 9 lignes sont celles du tableau)');
        if (o.graine !== undefined && o.graine !== null && !Number.isNaN(o.graine)) throw new Arret('--compte=ordinaire ne se combine pas avec --graine (les 9 lignes sont celles du tableau)');
    }
    const eteindre = o.eteindreSiSurFaux === undefined || o.eteindreSiSurFaux === null ? null : o.eteindreSiSurFaux;
    if (eteindre !== null) {
        if (!VARIABLES_EXTINCTION.includes(eteindre)) throw new Arret(`--eteindre-si-sur-faux n'admet que ${VARIABLES_EXTINCTION.join(', ')} : rien n'est lancé`);
        if (!COMMIT_ESSAI.test(String(o.commitEssai))) throw new Arret('--eteindre-si-sur-faux exige --commit-essai=<commit de la tête de la branche de l\'essai> : rien n\'est lancé');
        if (ct) throw new Arret('--eteindre-si-sur-faux ne se combine pas avec --compte=ordinaire');
    }
    const eteindreF = deps.eteindre || (a => eteindreSurRender(a));
    const ids = lireIdentifiants(o.env || process.env, o.fichierEnv, deps.lireFichier, ct ? { identifiant: NOM_ORDINAIRE_IDENTIFIANT, motDePasse: NOM_ORDINAIRE_MOT_DE_PASSE } : undefined);
    if (!ids) throw new Arret(`${ct ? NOM_ORDINAIRE_IDENTIFIANT : NOM_IDENTIFIANT} ou ${ct ? NOM_ORDINAIRE_MOT_DE_PASSE : NOM_MOT_DE_PASSE} absent : aucune requête n'est envoyée`);
    const origineSite = o.origineSite || ORIGINE_SITE;
    const coutEstimeUsd = o.coutEstimeUsd === undefined ? COUT_ESTIME_DEFAUT_USD : o.coutEstimeUsd;
    if (!(typeof coutEstimeUsd === 'number' && Number.isFinite(coutEstimeUsd) && coutEstimeUsd > 0)) throw new Arret('--cout-estime-usd doit être un nombre > 0');
    const carnet = ouvrirCarnet(o.carnet, { plafondUsd: o.plafondUsd, coutEstimeUsd });
    const modele = o.modele || MODELE_DEFAUT;
    // MODE --g-probable : tout ce qu'il faut pour MESURER est jugé avant la première requête (une série qui ne saurait pas produire ses mesures dépenserait pour rien)
    const gp = o.gProbable === true, declarer = o.declarations !== false;
    const versionClient = gp ? (o.versionExtension === undefined ? SP.VERSION_PROBABLE : o.versionExtension) : ct ? (o.versionExtension === undefined ? CT.VERSION_CLIENT : o.versionExtension) : null;
    if (ct && (typeof versionClient !== 'string' || !/^\d+\.\d+\.\d+$/.test(versionClient))) throw new Arret('--version-extension doit être de la forme x.y.z');
    let lireReference = null;
    if (gp || ct) {                                                                                 // le second envoi des mesures est celui de l'extension : --compte=ordinaire le fait comme --g-probable
        if (gp && o.deuxiemeApresSignal) throw new Arret('--g-probable ne se combine pas avec --deuxieme-apres-signal (le code de sortie et l\'arrêt au premier faux ne couvrent que la série 1)');
        if (typeof versionClient !== 'string' || !/^\d+\.\d+\.\d+$/.test(versionClient)) throw new Arret('--version-extension doit être de la forme x.y.z');
        if (!o.cartes) throw new Arret(`${gp ? '--g-probable' : '--compte=ordinaire'} exige --cartes= (la carte redressée de chaque ligne : les mesures du client se calculent dessus)`);
        lireReference = deps.lireReference || (Array.isArray(o.scans) && o.scans.length ? SP.lecteurDeReferences(o.scans) : null);
        // le cache local (--scans) n'est qu'un RACCOURCI facultatif : sans lui, les références se téléchargent de l'hôte public, comme l'extension (serie-probable.js::lecteurDeReferencesComplet)
    }
    const nav = o.nav && o.nav.photos ? o.nav.photos : {};
    const EV = require('../identifier/empreinte-vecteur');
    const candidates = lignesLocales(o.resultats).filter(l => (o.clesAvecVeriteSeulement !== true || Number.isInteger(l.verite)) && nav[clePhoto(l.cle)] && Array.isArray(nav[clePhoto(l.cle)].emb) && trouverFichier(o.photos, clePhoto(l.cle)));
    if (!candidates.length) throw new Arret('aucune ligne du banc n\'a à la fois un vecteur (nav-bancs.json) et une photo locale');
    // --cles : EXACTEMENT cette liste de lignes, dans cet ordre (une clé nue vaut sa ligne « <clé>:0 ») ; ni --n ni --graine ; une clé inconnue, sans photo ou sans vecteur, un doublon, une liste vide : refus avant toute requête
    let lignes;
    if (ct) {                                                                                         // les 9 lignes du TABLEAU, dans son ordre : la clé (ou son préfixe UNIQUE) trouve sa ligne du banc, dont la vérité est celle du tableau
        lignes = CT.TABLEAU.map(t => {
            const trouvees = candidates.filter(l => l.cle === t.cle || l.cle === `${t.cle}:0` || clePhoto(l.cle).startsWith(t.cle));
            if (trouvees.length !== 1) throw new Arret(`tableau, ligne ${t.rang} : ${trouvees.length} ligne(s) du banc pour la clé ${t.cle} (une seule est exigée, avec photo et vecteur locaux) : rien n'est lancé`);
            if (trouvees[0].verite !== t.verite) throw new Arret(`tableau, ligne ${t.rang} : la vérité du banc (${trouvees[0].verite ?? 'absente'}) n'est pas celle du tableau (${t.verite}) : rien n'est lancé`);
            return trouvees[0];
        });
        if (new Set(lignes.map(l => l.cle)).size !== lignes.length) throw new Arret('tableau : deux lignes désignent la même ligne du banc');
    }
    else if (o.cles !== undefined && o.cles !== null) {
        if (!Array.isArray(o.cles) || o.cles.length === 0 || !o.cles.every(c => typeof c === 'string' && c.length > 0)) throw new Arret('--cles doit être une liste non vide de clés');
        lignes = o.cles.map(c => candidates.find(l => l.cle === c) || candidates.find(l => l.cle === `${c}:0`));
        const manque = o.cles.filter((_, i) => !lignes[i]);
        if (manque.length) throw new Arret(`--cles : ${manque.length} clé(s) inconnue(s) ou sans photo/vecteur locaux : ${manque.slice(0, 5).join(' ')}`);
        if (new Set(lignes.map(l => l.cle)).size !== lignes.length) throw new Arret('--cles : une clé figure deux fois');
    } else lignes = echantillon(candidates, Math.min(o.n, candidates.length), o.graine);
    log(`série : graine ${o.cles ? 'sans (--cles)' : o.graine}, ${lignes.length} lignes sur ${candidates.length} possibles, plafond ${o.plafondUsd} USD (déjà au carnet : ${carnet.total().toFixed(4)}), coût estimé ${coutEstimeUsd} USD par scan, hôte ${HOTE_ESSAI}`);
    log(`lignes (ordre rejoué) : ${lignes.map(l => l.cle).join(' ')}`);
    if (gp || ct) {                                                                                 // le COÛT ESTIMÉ est imprimé et jugé avant toute requête (le total déjà au carnet compte)
        const estimation = lignes.length * coutEstimeUsd;
        log(`coût estimé avant toute requête : ${lignes.length} lignes × ${coutEstimeUsd} = ${estimation.toFixed(4)} USD (déjà au carnet : ${carnet.total().toFixed(4)}, plafond ${o.plafondUsd})`);
        if (carnet.total() + estimation > o.plafondUsd + 1e-12) throw new Arret(`estimation ${(carnet.total() + estimation).toFixed(4)} USD (carnet compris) au-dessus du plafond ${o.plafondUsd} : rien n'est lancé`);
    }
    const cacheHote = new Map();                                                                       // les références téléchargées de l'hôte public, pour la série

    const { appeler, definirJeton } = creerAppelant({ base, fetchF, delaiMs: DELAI_MS });       // le jeton d'installation LIÉ au compte de mesure (Bearer) reste dans cette fermeture : il ne sort jamais

    // le ping dit la version minimale de l'extension et si le jeton `empreinte` est annoncé
    // MODE --g-probable : avant le premier scan, DEUX /ping complets (toutes les capacités attendues, dont langue-impression et marques) espacés d'au moins 10 s ; un réveil à froid de l'essai (erreur, /ping partiel) s'attend, sans payer
    const attendrePing = async () => {
        const iterations = Math.max(1, Math.ceil(((o.attenteCapacitesMaxMin === undefined ? 10 : o.attenteCapacitesMaxMin) * 60) / 15));
        const lire = async () => { try { return await appeler('/ping', { method: 'GET' }, null); } catch (e) { if (e instanceof Arret) throw e; return null; } };
        let cur = await lire(), dernier = null;
        for (let i = 0; i < iterations; i++) {
            if (SP.pingComplet(cur)) {
                await pause(10000);                                                                    // l'espacement exigé entre les deux /ping complets
                const p2 = await lire();
                if (SP.pingComplet(p2)) return p2;
                cur = p2; continue;
            }
            dernier = cur;
            log(`/ping incomplet (capacités : ${cur && cur.corps && Array.isArray(cur.corps.capacites) ? cur.corps.capacites.join(', ') || '(aucune)' : 'illisible'}) : en attente`);
            await pause(15000); cur = await lire();
        }
        const manque = SP.CAPACITES_ATTENDUES.filter(c => !(dernier && dernier.corps && Array.isArray(dernier.corps.capacites) && dernier.corps.capacites.includes(c)));
        throw new Arret(`capacités du /ping incomplètes après l'attente : il manque ${manque.join(', ') || '(deux /ping complets de suite)'} : rien n'est lancé`);
    };
    const ping = gp || ct ? await attendrePing() : await appeler('/ping', { method: 'GET' }, null);
    if (ping.statut !== 200 || !ping.corps || typeof ping.corps.versionMinExtension !== 'string') throw new Arret(`/ping inattendu (${ping.statut}) : la v2 n'est pas annoncée, rien n'est envoyé`);
    const capacites = Array.isArray(ping.corps.capacites) ? ping.corps.capacites : [];
    log(`/ping : versionMinExtension ${ping.corps.versionMinExtension} ; capacités ${capacites.join(', ') || '(aucune)'} ; jeton empreinte ${capacites.includes('empreinte') ? 'PRÉSENT' : 'ABSENT (le serveur ne se sert pas encore des vecteurs)'}`);

    // ── la CONNEXION NORMALE : installation → connexion (cookie) → code → liaison. Tout refus arrête la série AVANT le moindre scan payé ; aucun détail de réponse n'est recopié (ils pourraient porter un secret).
    // (le chemin lui-même — connexion, installation avec la session, code, liaison — est dans connexion-essai.js, le même que celui du lanceur du juge)
    const lie = await connexionNormale({ appeler, definirJeton, ids, origineSite, versionExtension: ping.corps.versionMinExtension });
    if (ct) {                                                                                       // le compte de TEST est un compte gratuit ordinaire : s'il était administrateur, aucun débit ne se mesurerait
        if (!(lie.corps.compte && lie.corps.compte.administrateur === false && lie.corps.compte.verifie === true)) throw new Arret('le compte lié n\'est pas un compte ordinaire confirmé (administrateur ou non confirmé) : la série ne mesurerait aucun débit');
    } else if (!(lie.corps.compte && lie.corps.compte.administrateur === true)) throw new Arret('le compte lié n\'est pas administrateur : aucune photo ne peut être déposée');
    definirJeton(lie.corps.jetonInstallation);
    log(ct ? 'compte de test ordinaire connecté (installation liée, non administrateur)' : 'compte de mesure connecté (installation liée, administrateur)');

    // COMPTE-TEST : le solde et le quota du jour, lus par POST /api/solde (lecture pure, aucun débit) — avant la série, puis après chaque ligne. Illisible : arrêt.
    const lireSolde = async () => {
        const s = await appeler('/api/solde', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (s.statut !== 200 || !s.corps || typeof s.corps !== 'object' || !s.corps.solde || !s.corps.offre) throw new Arret(`/api/solde inattendu (${s.statut}) : la série s'arrête, le tableau ne se juge pas sans le solde`);
        return { solde: s.corps.solde, offre: s.corps.offre };
    };
    let soldeCourant = null;
    if (ct) {
        soldeCourant = await lireSolde();
        const invalide = CT.departInvalide(soldeCourant);
        if (invalide) throw new Arret(`départ refusé : ${invalide} : aucun scan n'est lancé`);
        carnet.noter({ compteTest: 'depart', offre: soldeCourant.offre, soldeTotal: soldeCourant.solde.total, achete: soldeCourant.solde.achete });
        log(`solde avant la série : offre ${soldeCourant.offre.nom}, restant ${soldeCourant.offre.restant}`);
    }

    const hashSerie = passe => crypto.createHash('sha1').update(`${o.graine}|${lignes.map(l => l.cle).join(',')}${passe > 1 ? `|passe${passe}` : ''}`).digest('hex').slice(0, 10);
    const stamp = (deps.maintenant || Date.now)().toString(36);

    /**
     * MODE --g-probable : ce qui suit la première réponse de /api/identifier. JAMAIS d'exception : un refus du serveur (401, 429) est rendu dans `arretReseau` (la série s'arrête APRÈS avoir écrit la ligne, le premier verdict
     * n'est pas perdu). Étapes : (1) juger le premier verdict ; (2) si c'est une QUESTION qui porte un complément, produire les mesures (fonctions de production) et faire le second envoi avec accepteProbable:true ;
     * (3) juger le verdict FINAL ; (4) déclarer comme l'extension le ferait ; (5) si un probable FAUX ou un sûr FAUX a été rendu : la ligne fautive, au carnet, avant que la série ne s'arrête.
     */
    const statutDeArret = raison => (/\(401\)/.test(raison) ? 401 : /^429 /.test(raison) ? 429 : null);       // le statut HTTP que dit un arrêt du client (null : une redirection, pas un statut)
    const incertainApresSecond = code => `${code} : issue incertaine après le second envoi sur /api/identifier/mesures : série arrêtée avant toute déclaration sur ce scan (le serveur a pu poser le marqueur probable avant de répondre)`;
    const statutIncertain = raison => { const m = /^statut (\d{3})/.exec(raison); return m ? Number(m[1]) : null; };
    /**
     * LE SECOND ENVOI, exactement comme l'extension >= 2.0.1 : quand la première réponse est une QUESTION qui porte un `complement`, produire les mesures demandées avec les fonctions de PRODUCTION (serie-probable.js::produireMesures :
     * ratmarket/zones.js, carte-redressee.js, validerResultats) sur la carte redressée et les références (cache local `--scans` facultatif, sinon l'hôte R2 PUBLIC comme l'extension), puis POST /api/identifier/mesures avec
     * `accepteProbable: true`. Partagé par --g-probable et --compte=ordinaire. Il n'ajoute AUCUN appel au modèle payant (le serveur ne rejoue que la règle G sur les mesures reçues). Ne lève jamais : un refus (401, 429, issue incertaine)
     * est rendu dans `arretReseau`. @returns {{ secondEnvoi, mesuresClient, classe, chemin, facturation2, arretReseau }} — `classe` est celle du résultat CHANGÉ (probable ou sûr) quand `change: true`, sinon `classe1` ; `facturation2` est celle du second envoi.
     */
    const secondEnvoiDesMesures = async ({ rang, serieId, etiquette, carteB64, issue, classe1 }) => {
        const scanId = typeof issue.scanId === 'string' ? issue.scanId : null, cplt = issue.complement;
        const r = { secondEnvoi: null, mesuresClient: null, classe: classe1, chemin: classe1.niveau === 'probable' ? 'PROBABLE' : classe1.niveau === 'question' ? 'QUESTION' : 'PREMIER', facturation2: null, arretReseau: null };
        const cle = suffixe => `serie-${serieId}-${rang}-${etiquette}-${suffixe}`;
        if (!(classe1.niveau === 'question' && scanId && cplt && typeof cplt === 'object' && typeof cplt.jeton === 'string' && Array.isArray(cplt.mesures) && cplt.mesures.length > 0)) return r;
        if (!carteB64) { r.secondEnvoi = { envoye: false, raison: 'carte-absente' }; return r; }
        const prod = await SP.produireMesures({ demande: cplt.mesures, carteB64, lireReference: SP.lecteurDeReferencesComplet({ local: lireReference, references: cplt.references, fetchFn: fetchF, cache: cacheHote, delaiMs: deps.delaiReferenceMs }), zones: deps.zones || require('../../ratmarket/zones'), carteRedressee: deps.carteRedressee || require('../identifier/carte-redressee'), validerResultats: require('../identifier/calcul-client').validerResultats });
        if (!prod.ok) { r.secondEnvoi = { envoye: false, raison: prod.raison }; return r; }
        r.mesuresClient = prod.resultats;
        try {
            const m = await appeler('/api/identifier/mesures', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': cle('m') }, body: JSON.stringify({ scanId, jeton: cplt.jeton, opencv: o.opencv || 'serie-essai-node', accepteProbable: true, resultats: prod.resultats }) });
            if (m.statut === 401) throw new Arret('jeton refusé (401) sur /api/identifier/mesures : le jeton d\'installation n\'est plus accepté ; série arrêtée');
            if (m.statut === 429) throw new Arret(`429 sur /api/identifier/mesures (reessayerDans ${m.retryApres ?? '?'}) : la série s'arrête, sans boucle`);
            // écrite par ce qu'elle AUTORISE : seuls 200 (corps lisible), 409 et 410 laissent continuer ; tout autre statut ou corps illisible ARRÊTE (le serveur a pu poser le marqueur probable avant de répondre)
            if (!(m.statut === 409 || m.statut === 410 || (m.statut === 200 && m.corps && typeof m.corps === 'object'))) throw new Arret(incertainApresSecond(m.statut === 200 ? '200 sans corps lisible' : `statut ${m.statut}`));
            r.secondEnvoi = { envoye: true, statut: m.statut, ...(m.statut === 200 && m.corps ? { change: m.corps.change === true } : {}) };
            if (m.statut === 200 && m.corps && m.corps.change === true) {
                const c2 = SP.classerCarte(m.corps.carte);
                if (c2.niveau === 'probable' || c2.niveau === 'sur') { r.classe = c2; r.chemin = c2.niveau === 'probable' ? 'G-GROUPE' : 'G-PROMOTION'; r.facturation2 = m.corps.facturation ?? null; }
            }
        } catch (e) {
            if (e instanceof Arret) { r.arretReseau = e.raison; r.secondEnvoi = { envoye: true, statut: statutDeArret(e.raison) ?? statutIncertain(e.raison) }; }
            else { const code = (e && (e.code || e.name)) || 'erreur'; r.arretReseau = incertainApresSecond(`exception ${code}`); r.secondEnvoi = { envoye: true, statut: null, erreur: code }; }
        }
        return r;
    };
    const suiteProbable = async ({ l, rang, serieId, etiquette, carteB64, issue, premierMs }) => {
        const scanId = typeof issue.scanId === 'string' ? issue.scanId : null, verite = l.verite;
        const classe1 = SP.classerCarte(issue.analyse && Array.isArray(issue.analyse.cartes) ? issue.analyse.cartes[0] : null), j1 = SP.jugerVerdict(classe1, verite);
        let classe = classe1, j = j1, chemin = classe1.niveau === 'probable' ? 'PROBABLE' : classe1.niveau === 'question' ? 'QUESTION' : 'PREMIER';
        let secondEnvoi = null, mesuresClient = null, declaration = null, arretReseau = null;
        const cle = suffixe => `serie-${serieId}-${rang}-${etiquette}-${suffixe}`;
        carnet.noter({ serie: serieId, rang, cle: l.cle, premierVerdict: { verdict: j1.verdict, niveau: classe1.niveau, ms: premierMs } });
        const cplt = issue.complement;
        const se = await secondEnvoiDesMesures({ rang, serieId, etiquette, carteB64, issue, classe1 });       // LE MÊME code que le mode --compte=ordinaire (jamais une copie)
        secondEnvoi = se.secondEnvoi; mesuresClient = se.mesuresClient; arretReseau = se.arretReseau;
        if (se.classe !== classe1) { classe = se.classe; j = SP.jugerVerdict(classe, verite); chemin = se.chemin; }
        // les déclarations du client (celles de l'extension) : même après un faux (« aucune » sur un probable faux) ; jamais si le serveur vient de refuser
        const decl = declarer && !arretReseau ? SP.declarationDe(classe, j.verdict, verite) : null;
        if (decl && scanId) {
            try {
                const rp = await appeler('/api/identifier/reponse', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': cle('r') }, body: JSON.stringify({ scanId, carte: 0, choix: decl.choix }) });
                if (rp.statut === 401) throw new Arret('jeton refusé (401) sur /api/identifier/reponse : le jeton d\'installation n\'est plus accepté ; série arrêtée');
                if (rp.statut === 429) throw new Arret(`429 sur /api/identifier/reponse (reessayerDans ${rp.retryApres ?? '?'}) : la série s'arrête, sans boucle`);
                declaration = { ...decl, statut: rp.statut };
            } catch (e) {
                if (e instanceof Arret) { arretReseau = e.raison; declaration = { ...decl, statut: statutDeArret(e.raison) }; }
                else declaration = { ...decl, statut: null, erreur: (e && (e.code || e.name)) || 'erreur' };
            }
        }
        let fautifLigne = null;
        if (SP.fautif(j.verdict)) {
            fautifLigne = { type: j.verdict, cle: l.cle, scanId, chemin, produit: classe.produit, candidats: classe1.candidats.length ? classe1.candidats : classe.candidats, verite, niveauPremier: classe1.niveau, premierMs,
                mesuresClient: chemin === 'G-GROUPE' || chemin === 'G-PROMOTION' ? mesuresClient : null, declaration };
            carnet.noter({ serie: serieId, rang, cle: l.cle, fautif: fautifLigne });                                            // écrite AU CARNET avant de rendre la main : un arrêt brutal ne la perd pas
        }
        return { premierNiveau: classe1.niveau, complementRecu: Boolean(cplt && typeof cplt === 'object' && typeof cplt.jeton === 'string' && Array.isArray(cplt.mesures) && cplt.mesures.length > 0), verdictPremier: j1.verdict, verdict: j.verdict, chemin, produit: classe.produit, candidats: classe.candidats.length ? classe.candidats : classe1.candidats, secondEnvoi, declaration, fautif: fautifLigne, arretReseau };
    };
    /**
     * MODE --compte=ordinaire : ce qui suit la première réponse de /api/identifier pour UNE ligne du tableau. JAMAIS d'exception (une issue incertaine arrête la série, elle ne la fait pas continuer). Dans l'ordre :
     * (1) le second envoi des mesures quand le serveur propose un complément (secondEnvoiDesMesures, le code de --g-probable : le chemin de l'extension), puis l'issue (première réponse → niveau final), le produit et les facturations face à la liste fermée d'issues de la ligne — au premier écart, RIEN n'est déclaré ; (2) la déclaration de l'issue, envoyée à POST /api/identifier/reponse ;
     * (3) le solde après (POST /api/solde) ; (4) la ligne entière face au tableau. Tout est inscrit au carnet : facturation servie, solde avant et après, déclaration envoyée, réponse du serveur.
     */
    const suiteCompteTest = async ({ l, rang, serieId, etiquette, carteB64, issue, att }) => {
        const scanId = typeof issue.scanId === 'string' ? issue.scanId : null;
        const classe1 = SP.classerCarte(issue.analyse && Array.isArray(issue.analyse.cartes) ? issue.analyse.cartes[0] : null);
        const avant = soldeCourant;
        // 1. le chemin d'un client réel : le second envoi des mesures quand le serveur propose un complément (le code partagé avec --g-probable) ; il n'ajoute aucun appel au modèle payant
        const se = await secondEnvoiDesMesures({ rang, serieId, etiquette, carteB64, issue, classe1 });
        const classe = se.classe;
        const obs = { niveauPremier: classe1.niveau, niveau: classe.niveau, produit: classe.produit, facturation: issue.facturation, facturation2: se.facturation2, choixEnvoye: null, statutReponse: null, reponse: null, restantAvant: avant.offre.restant, restantApres: null };
        const resume = s => ({ offre: { nom: s.offre.nom, restant: s.offre.restant }, total: s.solde.total, achete: s.solde.achete });
        let arretReseau = se.arretReseau, apres = null, soldeApresIllisible = null;
        const lireApres = async () => { try { apres = await lireSolde(); soldeCourant = apres; } catch (e) { soldeApresIllisible = e instanceof Arret ? e.raison : `exception ${(e && (e.code || e.name)) || 'erreur'} sur /api/solde`; } };
        const premier = arretReseau ? null : CT.comparerAvantDeclaration(att, obs);
        let e = premier;
        if (arretReseau) await lireApres();                                                              // un second envoi d'issue incertaine : RIEN n'est déclaré, la série s'arrête
        else if (!e) {
            const iss = CT.trouverIssue(att, obs);                                                        // non nulle : comparerAvantDeclaration vient de la trouver
            const choix = iss.declaration === null ? null : iss.declaration === 'aucune' ? 'aucune'
                : (classe.choix.find(c => c.idProduct === (iss.declaration === 'verite' ? att.verite : classe.produit)) || {}).id || null;
            if (iss.declaration !== null && choix !== null && scanId && (!iss.lettre || choix === iss.lettre)) {      // la lettre que le tableau attend (ligne 3 : « a ») se vérifie AVANT d'envoyer : une déclaration que le tableau ne prévoit pas ne part pas
                obs.choixEnvoye = choix;
                try {
                    const rp = await appeler('/api/identifier/reponse', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `serie-${serieId}-${rang}-${etiquette}-r` }, body: JSON.stringify({ scanId, carte: 0, choix }) });
                    obs.statutReponse = rp.statut;
                    obs.reponse = { facturation: rp.corps && rp.corps.facturation, declaration: rp.corps && rp.corps.declaration };
                    if (rp.statut === 401) arretReseau = 'jeton refusé (401) sur /api/identifier/reponse : le jeton d\'installation n\'est plus accepté ; série arrêtée';
                    else if (rp.statut === 429) arretReseau = `429 sur /api/identifier/reponse (reessayerDans ${rp.retryApres ?? '?'}) : la série s'arrête, sans boucle`;
                } catch (x) { arretReseau = x instanceof Arret ? x.raison : `exception ${(x && (x.code || x.name)) || 'erreur'} sur /api/identifier/reponse : issue incertaine après la déclaration, série arrêtée`; obs.statutReponse = null; }
            }
            await lireApres();
            if (apres) obs.restantApres = apres.offre.restant;
            e = arretReseau || soldeApresIllisible ? null : CT.comparerLigne(att, obs);
        } else await lireApres();
        const entree = { rang: att.rang, niveauPremier: classe1.niveau, niveau: classe.niveau, produit: classe.produit, chemin: se.chemin, secondEnvoi: se.secondEnvoi, scanId, facturation: issue.facturation ?? null, facturation2: se.facturation2, declarationEnvoyee: obs.choixEnvoye, reponse: obs.reponse ? { statut: obs.statutReponse, ...obs.reponse } : null,
            soldeAvant: resume(avant), soldeApres: apres ? resume(apres) : null, ecart: e || null };
        carnet.noter({ serie: serieId, rang, cle: l.cle, compteTest: entree });
        return { entree, ecart: e, arretReseau: arretReseau || soldeApresIllisible };
    };
    /** UNE passe sur les lignes (même ordre à chaque passe), avec le jeton gardé en MÉMOIRE ; le carnet est commun. */
    const jouer = async (passe, versionMin) => {
        const resultats = [], durees = [], erreurs = [];
        let arret = null, deSuite = 0, rang = 0, fautifLigne = null, questionsVues = 0, complementsVus = 0, alerte = false, ecartLigne = null, ligneNonJugee = null, extinction = null, arretExt = null;
        const sursNonJuges = [];                                                                       // I2 : les sûrs rendus sur une ligne SANS vérité : jamais jugés, jamais passés sous silence
        const serieId = hashSerie(passe), etiquetteCle = passe > 1 ? `${stamp}p${passe}` : stamp;
        /**
         * Le jugement d'une ligne (extinction automatique + sûrs non jugés). Appelé dès la première réponse, puis sur le verdict final d'un second envoi. Ne lève jamais (l'exécuteur est enveloppé).
         * I2 : un sûr sur une ligne SANS vérité ne peut pas être jugé faux, donc n'éteint rien ; il est COMPTÉ, écrit au carnet et listé en rouge au rapport de série.
         */
        const jugerSurs = async (l, rang, serieId, issue, observations) => {
            if (eteindre === null) return;                                                             // sans --eteindre-si-sur-faux, le client est celui d'avant, octet pour octet (ni carnet, ni journal, ni clé de résultat)
            const surs = observations.filter(x => x && x.sur === true);
            if (surs.length && !Number.isInteger(l.verite) && !sursNonJuges.some(x => x.cle === l.cle)) {
                const nj = { rang, cle: l.cle, produit: surs[0].produit, scanId: typeof issue.scanId === 'string' ? issue.scanId : null };
                sursNonJuges.push(nj);
                carnet.noter({ serie: serieId, rang, cle: l.cle, surNonJuge: nj });
                log(`🔴 SÛR NON JUGÉ (ligne sans vérité) : ${l.cle} (rang ${rang}) rend le sûr ${nj.produit} : jamais comptable juste ni faux, à regarder à la main`);
            }
            if (eteindre === null || extinction) return;
            const d = decisionExtinction({ variable: eteindre, verite: l.verite, observations });
            if (!d.eteindre) return;
            const quand = new Date((deps.maintenant || Date.now)()).toISOString();
            let res; try { res = await eteindreF({ variable: eteindre, commit: o.commitEssai }); } catch (x) { res = { ok: false, statut: null, erreur: (x && (x.code || x.name)) || 'erreur' }; }
            extinction = { quand, rang, cle: l.cle, scanId: typeof issue.scanId === 'string' ? issue.scanId : null, raison: d.raison, variable: eteindre, ok: Boolean(res && res.ok), statut: res ? res.statut ?? null : null };
            carnet.noter({ serie: serieId, rang, cle: l.cle, extinction });                                    // l'heure et la ligne, au carnet, avant de rendre la main
            log(`EXTINCTION ${quand} : ${d.raison} sur ${l.cle} (rang ${rang}) : ${eteindre}=0 sur l'essai ${extinction.ok ? 'POSÉE' : 'NON POSÉE (statut ' + extinction.statut + ') : À ÉTEINDRE À LA MAIN'}`);
            arretExt = `EXTINCTION AUTOMATIQUE (${d.raison}, ligne ${l.cle}) : ${eteindre}=0 ${extinction.ok ? 'posée' : 'NON POSÉE'} : série arrêtée avant le scan suivant`;
        };
        for (const l of lignes) {
            rang++;
            if (!carnet.peutDepenser()) { arret = `plafond atteint (${carnet.total().toFixed(4)} USD déjà inscrits, plafond ${o.plafondUsd}) : arrêt avant le scan ${rang}`; break; }
            const cp = clePhoto(l.cle), ph = trouverFichier(o.photos, cp), debut = horloge();
            let issue = null, carteB64 = null, premierMs = null, suite = null, suiteCT = null;
            try {
                const octets = fs.readFileSync(ph.fichier);
                const up = await appeler('/api/photo', { method: 'POST', headers: { 'Content-Type': ph.type, 'Content-Length': String(octets.length) }, body: octets });
                if (up.statut === 401) throw new Arret('jeton refusé (401) sur /api/photo : le jeton d\'installation n\'est plus accepté ; série arrêtée');
                if (up.statut === 429) throw new Arret(`429 sur /api/photo (reessayerDans ${up.retryApres ?? '?'}) : la série s'arrête, sans boucle`);
                // COMPTE-TEST : POST /api/photo est réservée à l'administrateur ; un compte ordinaire reçoit un 404. Ce refus arrête la série ICI, avant /api/identifier : sans photo reçue, le serveur retomberait sur l'adresse factice de l'annonce (Vinted).
                if (ct && (up.statut !== 200 || !up.corps || typeof up.corps.photoId !== 'string')) throw new Arret(`PHOTO REFUSÉE (${up.statut}) : le compte ordinaire ne peut pas déposer de photo, aucun scan n'est lancé (sans photo reçue le serveur retomberait sur l'adresse de l'annonce)`);
                if (up.statut !== 200 || !up.corps || typeof up.corps.photoId !== 'string') throw Object.assign(new Error('photo'), { code: `photo-${up.statut}` });
                const p = nav[cp];
                const entree = { photo: 0, vecteur: EV.encoderVecteur(Float32Array.from(p.emb)), redressee: p.redressee === true };
                if (o.cartes) { const cf = trouverFichier(o.cartes, cp); if (cf) entree.carte = fs.readFileSync(cf.fichier).toString('base64'); }
                // `contrat: 2` : sans lui l'aiguilleur (monter.js) renvoie vers la route HÉRITÉE, qui répond 401. Les autres champs sont ceux que la v2 attend (verifierEntree).
                carteB64 = entree.carte || null;
                const corps = { contrat: 2, versionExtension: gp || ct ? versionClient : versionMin, ...(gp || ct ? { capacitesClient: ['mesures-1'] } : {}), marche: 'vinted.fr', title: '', description: '', prixVinted: null, devise: null, langueInterface: 'fr', imageUrls: [IMAGE_ANNONCE], photoIds: [{ index: 0, photoId: up.corps.photoId }], empreintes: [entree], modeleEmpreinte: { id: modele.id, sha256: modele.sha256 } };
                carnet.inscrire({ serie: serieId, rang, cle: l.cle, graine: o.graine, ...(passe > 1 ? { passe } : {}) });                 // inscrit AVANT l'appel payant : un arrêt brutal ne laisse pas un scan hors carnet
                // DÈS QUE LA PHOTO EST DÉPOSÉE, la garde s'écrit par ce qu'elle AUTORISE : un SEUL chemin continue la série — « 200 avec `analyse.photoRecue === true` ». Toute autre issue (statut non 200, 429, corps vide, pas d'`analyse`, photoRecue absent ou faux,
                // exception, délai, redirection) ARRÊTE la série : on ne peut pas savoir si le serveur est retombé sur l'adresse factice de l'annonce, donc chez Vinted. Jamais de nouvel essai.
                const incertaine = code => new Arret(`${code} : série arrêtée : issue d'identification incertaine après dépôt de la photo (le serveur a pu retomber sur l'adresse de l'annonce)`);
                let id;
                try { id = await appeler('/api/identifier', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `serie-${serieId}-${rang}-${etiquetteCle}` }, body: JSON.stringify(corps) }); }
                catch (e) { throw e instanceof Arret ? e : incertaine(`exception ${(e && (e.code || e.name)) || 'erreur'} sur /api/identifier`); }
                const analyse = id.corps && typeof id.corps === 'object' && id.corps.analyse && typeof id.corps.analyse === 'object' ? id.corps.analyse : null;
                carnet.noter({ serie: serieId, rang, cle: l.cle, resultat: { statutHttp: id.statut, analyse: analyse !== null, photoRecue: analyse !== null && analyse.photoRecue === true } });   // ce que la réponse permet de lire ; jamais un coût
                if (id.statut === 429) throw incertaine(`429 sur /api/identifier (reessayerDans ${id.retryApres ?? '?'})`);
                if (id.statut !== 200 || !id.corps) throw incertaine(`identifier-${id.statut}`);
                if (!(analyse && analyse.photoRecue === true)) throw new Arret('photo non rattachée : le serveur a pu retomber sur l\'adresse de l\'annonce ; série arrêtée');
                issue = id.corps;
                // I1 : le jugement « sûr faux => éteindre » se fait ICI, avant suiteProbable / suiteCompteTest (ni une exception ni un Arret de la suite ne peut le sauter) ; I2 : un sûr sans vérité est compté, listé, jamais jugé
                { const s0 = sureDe(issue); await jugerSurs(l, rang, serieId, issue, [{ sur: s0.sur, produit: s0.produit }]); }
                if (gp && !extinction) {                                                                                          // sans l'option : AUCUNE lecture d'horloge de plus, le client est celui d'avant
                    premierMs = horloge() - debut;                                                                                // le PREMIER VERDICT : le dépôt de la photo + la première réponse de /api/identifier
                    suite = await suiteProbable({ l, rang, serieId, etiquette: etiquetteCle, carteB64, issue, premierMs });      // jamais d'exception : un refus du serveur est rendu dans `suite.arretReseau`
                }
                if (suite && suite.verdict === 'sur-faux') await jugerSurs(l, rang, serieId, issue, [{ sur: true, produit: suite.produit }]);       // le verdict FINAL d'un second envoi
                if (ct && !extinction) suiteCT = await suiteCompteTest({ l, rang, serieId, etiquette: etiquetteCle, carteB64, issue, att: CT.TABLEAU[rang - 1] });   // jamais d'exception : une issue incertaine est rendue dans `arretReseau`
            } catch (e) {
                if (extinction) { arret = arretExt; break; }                                           // I1 : un sûr faux déjà jugé ne se perd pas dans l'exception qui suit
                if (e instanceof Arret) { arret = e.raison; break; }
                erreurs.push({ cle: l.cle, code: (e && (e.code || e.name)) || 'erreur' });
                if (ct) {                                                                              // COMPTE-TEST : une ligne NON JUGÉE n'est jamais sautée — la série s'arrête (code 16), le bilan exige 9 lignes jugées sur 9
                    ligneNonJugee = { rang, cle: l.cle, code: erreurs[erreurs.length - 1].code };
                    carnet.noter({ serie: serieId, rang, cle: l.cle, ligneNonJugee });
                    arret = `LIGNE NON JUGÉE, ligne ${rang} (${l.cle}) : erreur ${ligneNonJugee.code} : série arrêtée, ${resultats.length} ligne(s) jugée(s) sur ${lignes.length}`;
                    break;
                }
                deSuite++;
                if (deSuite >= ERREURS_DE_SUITE_MAX) { arret = `${ERREURS_DE_SUITE_MAX} erreurs de suite : arrêt (dernier code ${erreurs[erreurs.length - 1].code})`; break; }
                continue;
            }
            deSuite = 0;
            const ms = horloge() - debut; durees.push(ms);
            const s = sureDe(issue);
            resultats.push({ cle: l.cle, ms, essaiSur: s.sur, essaiProduit: s.produit, localSur: l.localSur, localProduit: l.localProduit, verite: l.verite,
                ...(suite ? { famille: SP.familleDe(l, o.releveTampons), avecVerite: l.verite !== null && l.verite !== undefined, premierMs, premierNiveau: suite.premierNiveau, complementRecu: suite.complementRecu, verdictPremier: suite.verdictPremier, verdict: suite.verdict, chemin: suite.chemin, produit: suite.produit, candidats: suite.candidats, secondEnvoi: suite.secondEnvoi, declaration: suite.declaration } : {}), ...(suiteCT ? { compteTest: suiteCT.entree } : {}) });
            log(`  ${rang}/${lignes.length} ${l.cle} : ${ms} ms, essai ${s.sur ? `sûr ${s.produit}` : 'pas sûr'}, local ${l.localSur ? `sûr ${l.localProduit}` : 'pas sûr'}`);
            // EXTINCTION AUTOMATIQUE (jugée dès la première réponse, avant toute suite : relecture I1) : le premier SÛR FAUX a déjà éteint la variable ; la série s'arrête ici, après avoir inscrit la ligne.
            if (extinction) { arret = arretExt; break; }
            if (suiteCT) {
                const e = suiteCT.entree;
                log(`      tableau ligne ${rang} : niveau ${e.niveau}, facturation ${JSON.stringify(e.facturation && { debite: e.facturation.debite, reserve: e.facturation.reserve, rembourse: e.facturation.rembourse, motif: e.facturation.motif, raisonNonRembourse: e.facturation.raisonNonRembourse })}, déclaré ${e.declarationEnvoyee ?? 'rien'}, restant ${e.soldeAvant.offre.restant} -> ${e.soldeApres ? e.soldeApres.offre.restant : '?'} : ${suiteCT.ecart ? 'ÉCART' : suiteCT.arretReseau ? 'ARRÊT' : 'conforme'}`);
                if (suiteCT.ecart) { ecartLigne = { rang, cle: l.cle, ...suiteCT.ecart, scanId: e.scanId }; arret = `ÉCART AU TABLEAU, ligne ${rang} (${l.cle}) : ${suiteCT.ecart.champ}, attendu ${suiteCT.ecart.attendu}, observé ${suiteCT.ecart.observe} (scan ${e.scanId}) : série arrêtée avant le scan suivant, sans adapter la suite`; break; }
                if (suiteCT.arretReseau) { arret = suiteCT.arretReseau; break; }
            }
            if (suite) log(`      premier verdict ${premierMs} ms, total ${ms} ms, chemin ${suite.chemin} : ${suite.verdictPremier} -> ${suite.verdict}${suite.secondEnvoi ? ` (second envoi : ${JSON.stringify(suite.secondEnvoi)})` : ''}${suite.declaration ? ` ; déclaré « ${suite.declaration.choix} »` : ''}`);
            if (suite && suite.fautif) { fautifLigne = suite.fautif; arret = `ARRÊT FAUTE ${suite.fautif.type} sur ${l.cle} (chemin ${suite.fautif.chemin}, produit ${suite.fautif.produit}, candidats [${suite.fautif.candidats.join(',')}], vérité ${suite.fautif.verite}, scan ${suite.fautif.scanId}) : série arrêtée avant le scan suivant`; break; }
            if (suite && suite.arretReseau) { arret = suite.arretReseau; break; }
            if (suite && suite.premierNiveau === 'question') {                                           // l'EXERCICE du choix de groupe : une série « 0 faux » sans aucun complément ne mesure rien (V2_MESURES_CLIENT / V2_ORB_SERVEUR de l'essai)
                questionsVues++; if (suite.complementRecu) complementsVus++;
                if (questionsVues === 10 && complementsVus === 0) { alerte = true; arret = 'aucun complément sur les 10 premières questions : le choix de groupe n\'est pas exercé (V2_MESURES_CLIENT=1 et V2_ORB_SERVEUR=0 sont-elles posées sur l\'essai ?) : série arrêtée'; log(`ALERTE : ${arret}`); break; }
            }
            if (rang < lignes.length && o.pauseS > 0) await pause(o.pauseS * 1000);
        }
        const stats = statistiques(durees), comparaison = comparer(resultats);
        log(`${passe > 1 ? `[série ${passe}] ` : ''}durée par scan : n ${stats.n}, p50 ${stats.p50} ms, p95 ${stats.p95} ms`);
        log(`comparaison essai / local (mêmes lignes) : ${JSON.stringify(comparaison)}`);
        if (erreurs.length) log(`erreurs : ${JSON.stringify(erreurs)}`);
        if (sursNonJuges.length) log(`🔴 SÛRS NON JUGÉS : ${sursNonJuges.length} ligne(s) sans vérité ont rendu un sûr : ${sursNonJuges.map(x => x.cle).join(' ')}`);
        log(arret ? `ARRÊT : ${arret}` : 'série terminée');
        log(`dépense inscrite au carnet : ${carnet.total().toFixed(4)} USD sur un plafond de ${o.plafondUsd}`);
        let rapportProbable = null;
        if (gp) {
            rapportProbable = SP.rapportSerie(resultats, { statistiques });
            const T_ = rapportProbable.total;
            const X_ = rapportProbable.second;
            log(`lignes à vérité : ${T_.avecVerite}/${T_.lignes} · questions ${X_.questions}, compléments demandés ${X_.complements}, seconds envois faits ${X_.envoyes}, réponses change:true ${X_.changeTrue}, non faits : référence introuvable sur l'hôte public ${X_.nonEnvoyes['reference-introuvable-hote']}, carte absente ${X_.nonEnvoyes['carte-absente']}, autre ${X_.nonEnvoyes.autre}`);
            log(`rapport probable : sûrs ${T_.surJuste} justes / ${T_.surFaux} FAUX · probables ${T_.probableJuste} justes / ${T_.probableFaux} FAUX · questions ${T_.questionDansCandidats} (vérité dans les candidats) / ${T_.questionHorsCandidats} (hors) · introuvables ${T_.introuvable} · sans vérité ${T_.sansVerite} · réponse directe juste ${T_.reponseDirecteJuste} %`);
            log(`premier verdict : n ${rapportProbable.premierVerdict.n}, p50 ${rapportProbable.premierVerdict.p50} ms, p95 ${rapportProbable.premierVerdict.p95} ms ; total : p50 ${rapportProbable.dureeTotale.p50} ms, p95 ${rapportProbable.dureeTotale.p95} ms`);
        }
        return { arret, resultats, durees, stats, comparaison, erreurs, capacites, jetonEmpreinteAnnonce: capacites.includes('empreinte'), depenseUsd: carnet.total(), serie: serieId, lignes: lignes.map(l => l.cle), ...(gp ? { fautif: fautifLigne, alerte, rapportProbable } : {}), ...(extinction ? { extinction } : {}), ...(eteindre !== null ? { sursNonJuges } : {}), ...(ct ? { compteTest: true, ecart: ecartLigne, ligneNonJugee } : {}) };
    };

    const r1 = await jouer(1, ping.corps.versionMinExtension);
    if (!o.deuxiemeApresSignal) return r1;

    // ── MODE DEUX TEMPS : la même connexion (UNE installation, le jeton gardé en mémoire, jamais écrit), les mêmes lignes dans le même ordre, après un signal (un fichier qui apparaît) ──
    if (typeof o.apresSerie1 === 'function') await o.apresSerie1(r1);
    const vide = arret => ({ arret, resultats: [], durees: [], stats: statistiques([]), comparaison: comparer([]), erreurs: [], depenseUsd: carnet.total(), serie: hashSerie(2), lignes: lignes.map(l => l.cle) });
    if (r1.arret) { log(`série 2 non lancée : la série 1 s'est arrêtée (${r1.arret})`); return { ...r1, deuxieme: vide('série 2 non lancée : la série 1 s\'est arrêtée') }; }
    const existe = deps.existe || (f => fs.existsSync(f));
    const maxMin = o.attenteMaxMin === undefined ? 120 : o.attenteMaxMin, intervalleS = o.attenteIntervalleS || 30;
    if (!(typeof maxMin === 'number' && Number.isFinite(maxMin) && maxMin > 0)) throw new Arret('--attente-max-min doit être un nombre > 0');
    const verifications = Math.max(1, Math.ceil((maxMin * 60) / intervalleS));
    let signal = false;
    for (let i = 0; i < verifications; i++) {
        if (existe(o.deuxiemeApresSignal)) { signal = true; break; }
        log(`en attente du signal (${Math.round(i * intervalleS / 60 * 10) / 10} min sur ${maxMin} max)`);
        await pause(intervalleS * 1000);
    }
    if (!signal) { log(`ARRÊT série 2 : attente du signal expirée (${maxMin} min)`); return { ...r1, deuxieme: vide(`attente du signal expirée (${maxMin} min) : la série 2 n'est pas lancée`) }; }
    log('signal reçu : série 2 sur la même connexion');
    const ping2 = await appeler('/ping', { method: 'GET' }, null);
    if (ping2.statut !== 200 || !ping2.corps || typeof ping2.corps.versionMinExtension !== 'string') return { ...r1, deuxieme: vide(`/ping inattendu (${ping2.statut}) avant la série 2 : la série 2 n'est pas lancée`) };
    const capacites2 = Array.isArray(ping2.corps.capacites) ? ping2.corps.capacites : [];
    log(`/ping (série 2) : versionMinExtension ${ping2.corps.versionMinExtension} ; capacités ${capacites2.join(', ') || '(aucune)'} ; jeton empreinte ${capacites2.includes('empreinte') ? 'PRÉSENT' : 'ABSENT'}`);
    const r2 = await jouer(2, ping2.corps.versionMinExtension);
    return { ...r1, deuxieme: { ...r2, capacites: capacites2, jetonEmpreinteAnnonce: capacites2.includes('empreinte') } };
}
module.exports = { serie, baseAutorisee, echantillon, aleatoire, quantile, statistiques, lireVariable, lireIdentifiants, ouvrirCarnet, lignesLocales, sureDe, comparer, decisionExtinction, eteindreSurRender, VARIABLES_EXTINCTION, CODE_EXTINCTION, Arret, HOTE_ESSAI, NOM_IDENTIFIANT, NOM_MOT_DE_PASSE, NOM_ORDINAIRE_IDENTIFIANT, NOM_ORDINAIRE_MOT_DE_PASSE, ORIGINE_SITE, MODELE_DEFAUT, COUT_ESTIME_DEFAUT_USD };

if (require.main === module) {
    const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
    const num = (n, d) => { const v = arg(n); return v === null ? d : Number(v); };
    (async () => {
        const necessaire = n => { const v = arg(n); if (!v) throw new Arret(`argument --${n}= manquant`); return v; };
        const resultats = JSON.parse(fs.readFileSync(necessaire('resultats'), 'utf8')), nav = JSON.parse(fs.readFileSync(necessaire('nav'), 'utf8'));
        const modele = arg('modele-id') && arg('modele-sha256') ? { id: arg('modele-id'), sha256: arg('modele-sha256') } : MODELE_DEFAUT;
        const ecrire = (fichier, r) => fs.writeFileSync(fichier, JSON.stringify({ serie: r.serie, lignes: r.lignes, stats: r.stats, comparaison: r.comparaison, erreurs: r.erreurs, arret: r.arret, ...(r.extinction ? { extinction: r.extinction } : {}), ...(r.sursNonJuges && r.sursNonJuges.length ? { sursNonJuges: r.sursNonJuges } : {}), depenseUsd: r.depenseUsd, jetonEmpreinteAnnonce: r.jetonEmpreinteAnnonce, resultats: r.resultats, ...(r.rapportProbable ? { fautif: r.fautif, rapportProbable: r.rapportProbable } : {}), ...(r.compteTest ? { compteTest: true, ecart: r.ecart, ligneNonJugee: r.ligneNonJugee, lignesJugees: r.resultats.length } : {}) }, null, 1));
        const signal = arg('deuxieme-apres-signal');
        if (signal && !arg('sortie2')) throw new Arret('--deuxieme-apres-signal exige --sortie2= (la sortie de la série 2)');
        // MODE --g-probable : les dossiers des visuels de référence (lecture seule), le relevé des tampons (famille « tamponnee »), les déclarations ; les valeurs par défaut sont celles de extraire-mesures-groupe.js
        const gProbable = process.argv.includes('--g-probable');
        const DOSSIER_ARCHIVES = 'C:/Users/Yung/rat-market-travail/api/';
        const scans = gProbable || arg('compte') === 'ordinaire' ? (arg('scans') ? arg('scans').split(',').filter(Boolean) : [DOSSIER_ARCHIVES + 'index-empreintes-essai/images', DOSSIER_ARCHIVES + 'index-empreintes/images', DOSSIER_ARCHIVES + 'modele-visuel-hors-ligne/cache-archive/img']) : undefined;
        const fTampons = gProbable ? (arg('tampons') || DOSSIER_ARCHIVES + 'tampons/controle-tampons-2026-10-18.json') : null;
        const releveTampons = fTampons ? new Set(JSON.parse(fs.readFileSync(fTampons, 'utf8')).lignes.flatMap(l => l.scans.flatMap(s => s.cartes.map(k => k.cle)))) : undefined;
        // --cles=<fichier> : une liste de clés (tableau JSON de chaînes ou d'objets { cle }, ou une clé par ligne, « # » = commentaire), rejouée EXACTEMENT, dans cet ordre ; remplace --n et --graine
        const fCles = arg('cles');
        const cles = fCles ? (() => { const t = fs.readFileSync(fCles, 'utf8').trim(); const l = t.startsWith('[') ? JSON.parse(t) : t.split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#')); return l.map(x => (x && typeof x === 'object' ? x.cle : x)); })() : undefined;
        const compte = arg('compte') === null ? undefined : arg('compte');                           // COMPTE-TEST : seule la valeur « ordinaire » existe (serie() refuse toute autre)
        const r = await serie({ compte, base: arg('base') || undefined, resultats, nav, photos: necessaire('photos'), cartes: arg('cartes'), cles, gProbable: gProbable || undefined, scans, releveTampons, declarations: process.argv.includes('--sans-declarations') ? false : undefined, versionExtension: arg('version-extension') || undefined, n: fCles ? undefined : num('n', NaN), graine: fCles ? undefined : num('graine', NaN), plafondUsd: num('plafond-usd', NaN), carnet: arg('carnet'), clesAvecVeriteSeulement: process.argv.includes('--cles-avec-verite-seulement') || undefined, eteindreSiSurFaux: arg('eteindre-si-sur-faux') || undefined, commitEssai: arg('commit-essai') || undefined,
            fichierEnv: arg('env') || process.env.V2_ESSAI_ENV || null, pauseS: num('pause-s', 6), coutEstimeUsd: arg('cout-estime-usd') === null ? undefined : num('cout-estime-usd', NaN), modele, env: process.env,
            deuxiemeApresSignal: signal || undefined, attenteMaxMin: num('attente-max-min', 120), apresSerie1: async r1 => { if (arg('sortie')) ecrire(arg('sortie'), r1); } });
        if (arg('sortie') && !signal) ecrire(arg('sortie'), r);
        if (signal && r.deuxieme) ecrire(arg('sortie2'), r.deuxieme);
        process.exit(r.extinction ? CODE_EXTINCTION : compte === 'ordinaire' ? CT.codeSortie(r) : gProbable ? SP.codeSortie(r) : (r.arret || (r.deuxieme && r.deuxieme.arret) ? 1 : 0));          // 10 = probable FAUX, 11 = sûr FAUX (voir serie-probable.js), 1 = autre arrêt
    })().catch(e => { console.error(e instanceof Arret ? `ARRÊT : ${e.raison}` : `ERREUR ${e && (e.code || e.name)}`); process.exit(e instanceof Arret ? 2 : 1); });
}
