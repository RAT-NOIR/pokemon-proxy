// ============================================================
// RÉCOLTE WIKIDATA DES NOMS D'ESPÈCES zh — ENTITÉ PAR ENTITÉ, EN TÂCHE DE FOND (2026-10-31, décision de l'éditeur : GO, par le seul chemin que robots.txt autorise)
// ============================================================
//   node recolter-wikidata-especes.js [--sortie=<dossier wikidata>] [--priorites=<fichier>] [--graine=Q9351] [--plafond=1400] [--max-lectures=N] [--dexids=<fichier>]
//   NODE_PATH = node_modules du dépôt principal (collecte-cartes/jointure.js). Aucune variable d'environnement, aucune base, aucune connexion : lecture réseau de www.wikidata.org SEULEMENT.
//
// LES GARDES (elles s'écrivent par ce qu'elles AUTORISENT) :
//   · UN SEUL hôte, www.wikidata.org, UNE SEULE forme d'adresse : /wiki/Special:EntityData/Q<n>.json (et /robots.txt) ; le SPARQL, /w/api.php, en.wikipedia.org n'y sont pas — le client LÈVE avant toute requête ;
//   · robots.txt LU au démarrage et redemandé après 24 h (le client le garde) ; le chemin d'entité est contrôlé contre ce texte avant la première requête ;
//   · RH.garderHote consulté avant le démarrage ET avant chaque requête (le client) : un arrêt écrit (ARRET-HOTE-wikidata.org.json, dossier arrets-hotes) interdit tout, jusqu'à ce que le coordinateur le lève ;
//   · ≥ 5,5 s entre deux requêtes (cadence du client, plancher 5 s), un seul flux (verrou de l'hôte), User-Agent identifiable du dépôt (nom du projet + URL du site, sans adresse e-mail) ;
//   · au premier 401/403/410/429 ou défi : arrêt DÉFINITIF écrit par RH.arretHote (le client), code de sortie 3 ; une erreur serveur passagère est retentée 2 fois (60 s, 120 s) puis arrête (code 4) ;
//   · REPRISE : l'état (espèces lues, rejets, ruptures) est dans especes-zh.json et relu au lancement ; en plus, toute réponse déjà au cache n'est jamais redemandée.
// LA DÉCOUVERTE DES IDENTIFIANTS Q : voir collecte-cartes/wikidata-especes.js (graine vérifiée par elle-même, puis chaînage P155/P156 du Pokédex national, chaque pas vérifié par le numéro n±1).
// ORDRE : les espèces des noms intraduisibles de Gem Pack 4 et 5 (fichier --priorites) d'abord ; le jalon JALON-GEMPACK.json est écrit dès qu'elles sont toutes lues ; puis le reste de la table.
// SORTIES (dans --sortie) : especes-zh.json (lu par lireEspecesWikidata), LU-LE.txt, JALON-GEMPACK.json, journal-requetes.jsonl, cache/www.wikidata.org/.
// CODES DE SORTIE : 0 table complète · 2 usage / configuration · 3 ARRÊT D'HÔTE (définitif) · 4 erreur de lecture ou plafond · 5 graine non vérifiée · 6 marche finie mais INCOMPLÈTE (ruptures) · 7 limite de lectures.
'use strict';
const fs = require('fs');
const path = require('path');
const W = require('./collecte-cartes/wikidata-especes');
const RH = require('./collecte-cartes/reponse-hote');
const RC = require('./collecte-cartes/recolte-hote');
const T = require('./collecte-cartes/tpc');

const DEFAUT = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT-31/FICHES-SET/wikidata';
const HOTE = 'www.wikidata.org', RACINE = 'wikidata.org';
const AUTORISES = [/^--sortie=.+$/, /^--priorites=.+$/, /^--graine=Q\d{1,10}$/, /^--plafond=\d+$/, /^--max-lectures=\d+$/, /^--dexids=.+$/];

function arguments_(argv) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const v = n => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : undefined; };
    return { inconnus, sortie: v('sortie') || DEFAUT, priorites: v('priorites'), graine: v('graine') || 'Q9351', plafond: v('plafond') === undefined ? 1400 : Number(v('plafond')), maxLectures: v('max-lectures') === undefined ? Infinity : Number(v('max-lectures')), dexids: v('dexids') || path.join(__dirname, 'pokedex-dexids.json') };
}
const ecrireAtomique = (f, texte) => { const tmp = `${f}.tmp-${process.pid}`; fs.writeFileSync(tmp, texte); fs.renameSync(tmp, f); };

/** `dep` (bancs seulement) : transport, dossierPauses, pause — jamais utilisé par la ligne de commande. */
async function main(argv, dep = {}) {
    const dossierPauses = dep.dossierPauses || RH.DOSSIER_PAUSES;
    const A = arguments_(argv);
    if (A.inconnus.length) { console.error(`❌ argument inconnu : ${A.inconnus.join(' ')} (une ligne de commande s'écrit par ce qu'elle autorise)`); return 2; }
    let dexids;
    try { dexids = JSON.parse(fs.readFileSync(A.dexids, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { console.error(`❌ pokedex-dexids illisible (${e.message})`); return 2; }
    const maxDex = Math.max(...Object.values(dexids).flat().filter(Number.isFinite));
    if (!(maxDex >= 1000)) { console.error(`❌ pokedex-dexids : numéro maximal ${maxDex} (< 1000) — table suspecte, arrêt`); return 2; }
    let priorites = [];
    const fp = A.priorites || path.join(A.sortie, 'PRIORITES-GEMPACK.json');
    if (fs.existsSync(fp)) {
        try { priorites = JSON.parse(fs.readFileSync(fp, 'utf8')).especes; } catch (e) { console.error(`❌ fichier de priorités illisible (${e.message})`); return 2; }
        if (!Array.isArray(priorites) || !priorites.every(p => Number.isInteger(p.dex))) { console.error('❌ fichier de priorités mal formé : { especes: [{ dex, noms, sets }] } attendu'); return 2; }
    } else console.log(`(aucun fichier de priorités : ${fp} — pas de jalon, la table se fait dans l'ordre du chaînage)`);
    fs.mkdirSync(A.sortie, { recursive: true });
    const fichier = path.join(A.sortie, 'especes-zh.json');
    let etatInitial = null;
    if (fs.existsSync(fichier)) { try { etatInitial = JSON.parse(fs.readFileSync(fichier, 'utf8')).etat || null; } catch (e) { console.error(`❌ ${fichier} illisible (${e.message}) — rien n'est écrasé`); return 2; } }

    // 1. la garde de l'hôte AVANT tout (un arrêt écrit interdit tout)
    try { RH.garderHote(RACINE, dossierPauses); } catch (e) { console.error(`❌ ARRÊT D'HÔTE EN VIGUEUR : ${e.message}`); return 3; }

    // 2. le client poli du dépôt : table FERMÉE d'hôtes, une seule forme de chemin
    const client = RC.fabriquerClient({
        racine: RACINE, hotes: { 'www.wikidata.org': { chemin: W.CHEMIN_AUTORISE, racine: 'wikidata.org' } },
        dossierCache: path.join(A.sortie, 'cache', HOTE), plafond: A.plafond, cadenceMs: 5500, journal: path.join(A.sortie, 'journal-requetes.jsonl'),
        dossierPauses, ...(dep.transport ? { transport: dep.transport } : {}), ...(dep.pause ? { pause: dep.pause } : {})
    });
    const sortie = code => { client.liberer(); console.log(`\nrequêtes réseau de ce lancement : ${client.requetes()} · codes ${JSON.stringify(client.codes())} · code de sortie ${code}`); return code; };
    process.on('SIGINT', () => { client.liberer(); console.error('interrompu (SIGINT) — l\'état écrit est complet jusqu\'à la dernière espèce lue'); process.exit(130); });
    try {
        const r = await client.initialiserRobots(HOTE);
        if (r.statut !== 'present') { console.error('❌ robots.txt de www.wikidata.org non lu (absent) : on ne peut pas conclure'); return sortie(2); }
        if (!T.autoriseParRobots(r.texte, '/wiki/Special:EntityData/Q9351.json', RC.UA)) { console.error('❌ robots.txt interdit /wiki/Special:EntityData/ — aucune requête'); return sortie(2); }
    } catch (e) { console.error(`❌ ${e.bloque ? 'ARRÊT D\'HÔTE : ' : 'robots.txt : '}${e.message}`); return sortie(e.bloque ? 3 : 4); }

    // 3. la lecture d'une entité : réduite avant le cache, 404 = absente, redirection non suivie, erreur serveur retentée deux fois
    const lire = async q => {
        const url = `https://${HOTE}/wiki/Special:EntityData/${q}.json`;
        for (let essai = 0; ; essai++) {
            try {
                const r = await client.lire(url, { reduire: texte => W.reduireEntite(texte, q) });
                if (r.status === 404) return { absente: true, cache: r.cache };
                return { json: r.texte, cache: r.cache };
            } catch (e) {
                if (e && e.status >= 300 && e.status < 400) return { redirigee: true };
                if (e && e.transitoire && essai < 2) { console.error(`(${q} : ${e.message} — nouvel essai dans ${60 * (essai + 1)} s)`); await (dep.pause || (ms => new Promise(res => setTimeout(res, ms))))(60000 * (essai + 1)); continue; }
                throw e;
            }
        }
    };
    let derniereLigne = 0;
    const ecrire = etat => {
        const luLe = new Date().toISOString();
        ecrireAtomique(fichier, JSON.stringify(W.construireSortie(etat, { luLe, requetes: etat.lectures })));
        ecrireAtomique(path.join(A.sortie, 'LU-LE.txt'), luLe);
        const n = Object.keys(etat.lus).length;
        if (n - derniereLigne >= 25 || n < 5) { derniereLigne = n; console.log(`${luLe} · ${n} espèces lues · ${etat.rejets.length} rejet(s) · ${client.requetes()} requêtes réseau`); }
    };
    const jalon = j => {
        ecrireAtomique(path.join(A.sortie, 'JALON-GEMPACK.json'), JSON.stringify(j, null, 1));
        console.log(`\n█ JALON GEM PACK : les ${j.especes.length} espèces prioritaires sont lues (${j.requetes} lectures) — concordance libellé de la source / libellés Wikidata : ${JSON.stringify(Object.fromEntries(j.especes.map(e => [e.dex, e.concordance])))}\n`);
    };

    const res = await W.marcher({ lire, graine: A.graine, dexids, maxDex, priorites, etatInitial, ecrire, jalon, maxLectures: A.maxLectures });
    ecrire(res.etat);
    (res.code === 0 ? console.log : console.error)(`${res.code === 0 ? '✅' : '❌'} ${res.message}`);
    return sortie(res.code);
}

module.exports = { main };
if (require.main === module) main(process.argv.slice(2)).then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e && e.stack || e); process.exitCode = 4; });
