'use strict';
// LOT TEMPS-ETAPES — (1) le CHRONOMÈTRE des étapes d'un scan : `analyses.durees`, un champ ADDITIF (rien n'est retiré, rien d'autre que des nombres n'y entre) ; (2) les quatre DRAPEAUX des coupes de temps.
//
// Le chronomètre. Chaque étape a un NOM d'une liste FERMÉE (ETAPES) : un nom hors liste LÈVE (un bogue du code qui l'appelle, jamais une donnée) et une valeur qui n'est pas un nombre fini >= 0 est ignorée,
// si bien que le champ ne peut porter ni texte, ni adresse, ni secret, ni NaN. Les durées d'une même étape s'ADDITIONNENT ; `total` court de la création du chronomètre à l'export.
// Trois mesures de plus, calculées à l'export et dites à part :
//   · `cpu` : le temps de CALCUL par étape (process.cpuUsage, ms, user + system). C'est celui du PROCESSUS ENTIER pendant l'étape : sur un scan seul il dit ce que l'étape a CALCULÉ (par opposition à ce qu'elle a ATTENDU) ;
//     avec plusieurs scans en vol il surestime. Il sert à séparer ce qui tient à l'offre gratuite (0,15 vCPU : le calcul y est étiré ~7 fois) de ce qui sera pareil en production (un appel au modèle, le réseau : de l'attente) ;
//   · `gc` : le temps passé en RAMASSE-MIETTES (PerformanceObserver « gc ») pendant la durée du scan, tous scans confondus ; sur une instance à 450-500 Mo de 512, c'est le suspect d'un arrêt de plusieurs secondes sans cause visible ;
//   · `rssMo` : la mémoire résidente du processus à l'export (Mo) — pas une durée, un témoin de la même hypothèse.
//
// Les drapeaux (configuration, `booleen()`, éteints par défaut ; seul `true` allume). Éteints, la route est celle d'avant octet pour octet :
//   · voisinsUneFois  (V2_TE_VOISINS_UNE_FOIS)  la recherche des 10 voisins (≈ 15 millions de produits scalaires) se fait UNE fois par requête, pas une fois par lecteur du vecteur (la règle G, puis SUR-PAR-IMAGE) ;
//   · empreinteTot    (V2_TE_EMPREINTE_TOT)     la recherche et la garde des zones partent dès que la requête est acceptée, pendant l'attente du modèle, au lieu de la fin de la chaîne ;
//   · finParallele    (V2_TE_FIN_PARALLELE)     les lectures et écritures annexes indépendantes de la fin de requête partent ensemble (solde, offre, taux ; ligne d'analyse, annonce) ; la clôture reste LA DERNIÈRE ;
//   · orbUtile        (V2_TE_ORB_UTILE)         la règle G (recherche des voisins + garde des zones : l'ORB) n'est pas consultée quand la chaîne rend un INTROUVABLE : l'arbitrage rend « garder » quoi que G dise, la promotion
//                                               d'un introuvable est interdite (depuisIntrouvable: false). Seule différence visible : `empreinte` / `desaccordRegleG` / `empreinteExtension` (journal), jamais une décision, un candidat, un sûr, un débit.
const { performance, PerformanceObserver } = require('perf_hooks');

const ETAPES = Object.freeze([
    'photo',            // le dépôt de la photo (POST /api/photo) : lecture du corps, validation, réencodage — la requête qui précède le scan
    'photoTraitement',  // dont la validation et le réencodage (sharp : du calcul), sans la lecture du corps (du réseau)
    'lecture',          // l'appel au modèle (OpenRouter) : la lecture de la carte
    'etat',             // l'attente de l'état des photos après la lecture (au plus 2 s)
    'catalogue',        // le catalogue + TCGdex + le scoring de la chaîne héritée
    'image',            // le départage par l'image (ORB) de la chaîne héritée
    'chaine',           // la chaîne héritée en entier (lecture + état + catalogue + scoring + image + journal)
    'voisins',          // la recherche des 10 voisins dans l'index des empreintes (calcul)
    'empreinte',        // le fournisseur d'empreinte en entier (voisins + carte + garde des zones)
    'orb',              // la garde des zones (ORB) du fournisseur : le calcul des mesures (OpenCV), sans le téléchargement des scans
    'scans',            // le téléchargement des scans de l'archive pour la garde des zones (réseau, sur notre bucket public)
    'seconde',          // la seconde lecture (appel au modèle)
    'tampon',           // la lecture du tampon (appel au modèle)
    'sur',              // SUR-PAR-IMAGE
    'base',             // les lectures et écritures Mongo de la route après la chaîne (catalogue v2, jumeaux, solde, offre, analyses, annonce, marque)
    'total'             // le gestionnaire entier, de la validation à la réponse
]);

/** @returns {{voisinsUneFois: boolean, empreinteTot: boolean, finParallele: boolean, orbUtile: boolean}} — seul `true` allume ; sans configuration, tout éteint. */
function reglages(cfg) {
    const t = cfg && cfg.tempsEtapes && typeof cfg.tempsEtapes === 'object' ? cfg.tempsEtapes : {};
    return { voisinsUneFois: t.voisinsUneFois === true, empreinteTot: t.empreinteTot === true, finParallele: t.finParallele === true, orbUtile: t.orbUtile === true };
}

// ── le ramasse-miettes : un observateur du processus (créé à la première demande, unref : il ne retient jamais le processus), les 256 dernières pauses gardées avec leur début (horloge performance.now)
const PAUSES = []; let observateur = null;
function observerGc() {
    if (observateur !== null) return;
    observateur = false;
    try {
        const o = new PerformanceObserver(liste => { for (const e of liste.getEntries()) { PAUSES.push([e.startTime, e.duration]); if (PAUSES.length > 256) PAUSES.shift(); } });
        o.observe({ entryTypes: ['gc'] });
        observateur = o;
    } catch { observateur = false; }                                  // pas d'observateur : `gc` n'est simplement pas écrit
}
/** Les ms de ramasse-miettes qui chevauchent [debut, fin] (horloge performance.now). null si l'observateur n'est pas disponible. */
function gcEntre(debut, fin) {
    if (!observateur) return null;
    let s = 0;
    for (const [d, dur] of PAUSES) { const a = Math.max(d, debut), b = Math.min(d + dur, fin); if (b > a) s += b - a; }
    return s;
}

const millisCpu = (a, b) => ((b.user - a.user) + (b.system - a.system)) / 1000;           // process.cpuUsage() est en microsecondes

/** @param {{horloge?: () => number, cpu?: () => {user: number, system: number}, gc?: (debut: number, fin: number) => number|null, rss?: () => number}} [o] — injectables par les bancs. */
function creerChrono({ horloge = () => performance.now(), cpu = () => process.cpuUsage(), gc = null, rss = () => process.memoryUsage.rss() } = {}) {
    if (gc === null) observerGc();
    const lireGc = gc || gcEntre;
    const ms = Object.create(null), cpuMs = Object.create(null);
    const debut = horloge();
    const nom = n => { if (typeof n !== 'string' || !ETAPES.includes(n)) throw new Error(`étape inconnue « ${typeof n === 'string' ? n.slice(0, 20) : typeof n} »`); return n; };
    const bon = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    function ajouter(n, dt, dc) {
        nom(n);
        if (bon(dt)) ms[n] = (ms[n] || 0) + dt;
        if (bon(dc) && n !== 'total') cpuMs[n] = (cpuMs[n] || 0) + dc;
    }
    async function mesurer(n, fonction) {
        nom(n);
        const t0 = horloge(), c0 = cpu();
        try { return await fonction(); } finally { ajouter(n, horloge() - t0, millisCpu(c0, cpu())); }
    }
    function mesurerSync(n, fonction) {
        nom(n);
        const t0 = horloge(), c0 = cpu();
        try { return fonction(); } finally { ajouter(n, horloge() - t0, millisCpu(c0, cpu())); }
    }
    /** Pose une durée déjà mesurée ailleurs (la chaîne héritée, le dépôt de la photo). Valeur invalide : ignorée. */
    function poser(n, dureeMs, cpuDuMs) { ajouter(n, dureeMs, cpuDuMs); }
    function exporter() {
        const fin = horloge();
        const sortie = {};
        for (const n of ETAPES) if (n !== 'total' && n in ms) sortie[n] = Math.round(ms[n]);
        sortie.total = Math.max(0, Math.round(fin - debut));
        const c = {};
        for (const n of ETAPES) if (n in cpuMs) c[n] = Math.round(cpuMs[n]);
        sortie.cpu = c;
        let g = null; try { g = lireGc(debut, fin); } catch { g = null; }
        if (bon(g)) sortie.gc = Math.round(g);
        let r = null; try { r = rss(); } catch { r = null; }
        if (bon(r)) sortie.rssMo = Math.round(r / 1048576);
        return sortie;
    }
    return { mesurer, mesurerSync, poser, exporter };
}

module.exports = { ETAPES, reglages, creerChrono };
