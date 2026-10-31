// ============================================================
// ZONE D'ATTENTE -> CACHE PARTAGÉ (outil générique, décision de l'éditeur du 2026-10-31) — AUCUN RÉSEAU, aucune base
// ============================================================
//   node collecte-cartes/zone-attente-vers-cache.js --dossier=<zone>|--manifeste=<f>.json --cache=<…\PHASE4\CACHE> [--ecrire --attendu=N]      (DÉFAUT : simulation, rien n'est écrit)
// Des images déjà téléchargées (zone d'attente : un dossier de fichiers, chacun avec son `.provenance.json` {urlImage, date}, ou un manifeste { entrees: [{url, fichier, sha256?}] }) sont VERSÉES dans le cache
// partagé des collecteurs « récolte » (collecte-cartes/recolte-hote.js : une paire `<nomCache(url)>.json` / `.bin`, statut `ok`, sha256, octets) — la voie `prv` (collecteur-images-preuves.js) les y relit,
// jamais crues (P8 : sha256 du manifeste, de la fiche du cache, du fichier cité).
// ÉCRIT PAR CE QU'IL AUTORISE : adresse https, fichier lisible, image décodable, sha256 annoncé égal au sha256 réel. Une adresse déjà au cache avec D'AUTRES octets n'est JAMAIS écrasée ; deux fichiers de
// même adresse et de contenus différents sont refusés. Les sources ne sont ni déplacées, ni supprimées, ni modifiées. Le cache doit s'appeler « CACHE » (une garde sur le chemin, pas sur un nom d'hôte).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HOTE = require('./recolte-hote');

const sha256De = b => crypto.createHash('sha256').update(b).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;
const TYPES = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
const SUFFIXE = '.provenance.json';

/** Le dossier d'attente : une entrée par fichier qui porte sa provenance ; un fichier sans provenance (ou à provenance illisible) est refusé et nommé. @returns {{entrees: object[], refus: object[]}} */
function lireDossier(dossier) {
    const entrees = [], refus = [];
    const noms = fs.readdirSync(dossier).filter(n => !n.endsWith(SUFFIXE) && fs.statSync(path.join(dossier, n)).isFile()).sort();
    for (const n of noms) {
        const f = path.join(dossier, n), pf = f + SUFFIXE;
        if (!fs.existsSync(pf)) { refus.push({ fichier: f, raison: `aucune provenance (${n}${SUFFIXE}) : une image sans adresse d'origine n'entre pas au cache` }); continue; }
        let prov; try { prov = JSON.parse(fs.readFileSync(pf, 'utf8')); } catch (e) { refus.push({ fichier: f, raison: `provenance illisible (${e.message})` }); continue; }
        entrees.push({ url: prov.urlImage, fichier: f, le: prov.date ?? null, page: prov.urlPage ?? null });
    }
    return { entrees, refus };
}

/** Un manifeste { entrees: [{ url, fichier, sha256? }] } (toute autre clé est ignorée). LÈVE sur une entrée mal formée. */
function lireManifeste(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.entrees)) throw new Error('manifeste : « entrees » (tableau) attendu');
    return obj.entrees.map((e, i) => {
        if (!e || typeof e.url !== 'string' || !e.url) throw new Error(`entrees[${i}] : url attendue`);
        if (typeof e.fichier !== 'string' || !e.fichier) throw new Error(`entrees[${i}] : fichier attendu`);
        if (e.sha256 !== undefined && !HEX64.test(e.sha256)) throw new Error(`entrees[${i}] : sha256 de 64 caractères hexadécimaux minuscules attendu`);
        return { url: e.url, fichier: e.fichier, ...(e.sha256 ? { sha256: e.sha256 } : {}), le: e.luLe ?? e.le ?? null };
    });
}

const decodable = async octets => { try { const m = await require('sharp')(octets).metadata(); return m.width > 0 && m.height > 0 ? { w: m.width, h: m.height } : null; } catch { return null; } };

/**
 * @param {{entrees: object[], cache: string, lireFichier?: Function, jugerImage?: Function}} o
 * @returns {Promise<{aEcrire: object[], dejaAuCache: object[], refus: object[], denominateurs: object}>}
 */
async function planifier({ entrees, cache, lireFichier = f => fs.readFileSync(f), jugerImage = decodable }) {
    const aEcrire = [], dejaAuCache = [], refus = [], parUrl = new Map();
    for (const e of entrees) {
        const non = raison => refus.push({ url: e.url ?? null, fichier: e.fichier ?? null, raison });
        let https = false; try { https = new URL(e.url).protocol === 'https:'; } catch { /* refus ci-dessous */ }
        if (!https) { non('adresse https attendue'); continue; }
        let octets; try { octets = lireFichier(e.fichier); } catch (err) { non(`fichier illisible (${err.message})`); continue; }
        if (!octets || !octets.length) { non('fichier vide'); continue; }
        const sha = sha256De(octets);
        if (e.sha256 && e.sha256 !== sha) { non(`sha256 annoncé ${e.sha256.slice(0, 12)}… ≠ sha256 du fichier ${sha.slice(0, 12)}…`); continue; }
        const dim = await jugerImage(octets);
        if (!dim) { non('le fichier n\'est pas une image décodable'); continue; }
        const vu = parUrl.get(e.url);
        if (vu) {
            if (vu.sha256 !== sha || vu.conflit) {
                // deux contenus pour UNE adresse : AUCUN des deux ne s'écrit (le premier, déjà retenu, est retiré)
                const raison = `deux fichiers pour la même adresse avec des octets différents (${path.basename(vu.fichier)} / ${path.basename(e.fichier)})`;
                if (!vu.conflit) { vu.conflit = true; const i = aEcrire.findIndex(x => x.url === e.url); if (i >= 0) aEcrire.splice(i, 1); const j = dejaAuCache.findIndex(x => x.url === e.url); if (j >= 0) dejaAuCache.splice(j, 1); refus.push({ url: e.url, fichier: vu.fichier, raison }); }
                non(raison);
            }
            continue;
        }
        parUrl.set(e.url, { sha256: sha, fichier: e.fichier });
        const nom = HOTE.nomCache(e.url), existant = HOTE.lireDuCache(cache, e.url);
        if (existant) {
            if (sha256De(existant.octets) === sha) { dejaAuCache.push({ url: e.url, nom, sha256: sha }); continue; }
            non('l\'adresse est déjà au cache avec d\'AUTRES octets : jamais écrasée'); continue;
        }
        const jsonExiste = fs.existsSync(path.join(cache, nom));
        if (jsonExiste) { non('une fiche de cache existe déjà pour cette adresse (absence, pause ou octets manquants) : jamais écrasée'); continue; }
        aEcrire.push({ url: e.url, fichier: e.fichier, nom, sha256: sha, octets: octets.length, largeur: dim.w, hauteur: dim.h, le: e.le ?? null, type: TYPES[path.extname(e.fichier).toLowerCase()] ?? '' });
    }
    return { aEcrire, dejaAuCache, refus, denominateurs: { entrees: entrees.length, aEcrire: aEcrire.length, dejaAuCache: dejaAuCache.length, refusees: refus.length } };
}

/** Écrit la paire .bin puis .json (le .json en dernier : une fiche sans octets n'existe jamais), puis RELIT chaque image par lireDuCache (octets et sha256). */
async function ecrire({ plan, cache, maintenant = () => new Date().toISOString(), lireFichier = f => fs.readFileSync(f) }) {
    let ecrites = 0, relues = 0;
    for (const x of plan.aEcrire) {
        const octets = lireFichier(x.fichier);
        if (sha256De(octets) !== x.sha256) throw new Error(`${x.fichier} a changé depuis la simulation (sha256) — arrêt, rien de plus n'est écrit`);
        const f = path.join(cache, x.nom), fb = f.replace(/\.json$/, '.bin');
        fs.writeFileSync(fb, octets);
        fs.writeFileSync(f, JSON.stringify({ url: x.url, statut: 'ok', status: 200, type: x.type, octets: octets.length, sha256: x.sha256, le: x.le ?? maintenant(), importeDe: 'zone-attente', fichierSource: x.fichier }));
        ecrites++;
        const c = HOTE.lireDuCache(cache, x.url);
        if (c && sha256De(c.octets) === x.sha256 && c.meta.sha256 === x.sha256) relues++;
    }
    return { ecrites, relues };
}

const AUTORISES = [/^--dossier=.+$/, /^--manifeste=.+\.json$/, /^--cache=.+$/, /^--ecrire$/, /^--attendu=\d+$/];
function verifierArguments(argv) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) return `argument inconnu : ${inconnus.join(' ')}`;
    const a = n => argv.some(x => x.startsWith(`--${n}=`));
    if (a('dossier') && a('manifeste')) return 'un seul de --dossier ou --manifeste';
    if (!a('dossier') && !a('manifeste')) return '--dossier=<zone d\'attente> ou --manifeste=<f>.json exigé';
    if (!a('cache')) return '--cache=<dossier CACHE> exigé';
    if (argv.includes('--ecrire') && !a('attendu')) return '--ecrire exige --attendu=<N>';
    if (a('attendu') && !argv.includes('--ecrire')) return '--attendu ne va qu\'avec --ecrire';
    return null;
}

async function executer({ argv, log = console.log, err = console.error }) {
    const refus = verifierArguments(argv);
    if (refus) { err(`❌ ${refus} — rien n'est écrit`); return 2; }
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const cache = arg('cache');
    if (path.basename(path.resolve(cache)) !== 'CACHE' || !fs.existsSync(cache) || !fs.statSync(cache).isDirectory()) { err('❌ le cache doit être un dossier existant nommé « CACHE » — rien n\'est écrit'); return 2; }
    let entrees, refusLecture = [];
    try {
        if (arg('dossier')) { const r = lireDossier(arg('dossier')); entrees = r.entrees; refusLecture = r.refus; }
        else entrees = lireManifeste(JSON.parse(fs.readFileSync(arg('manifeste'), 'utf8').replace(/^﻿/, '')));
    } catch (e) { err(`❌ ${e.message} — rien n'est écrit`); return 2; }
    const plan = await planifier({ entrees, cache });
    plan.refus.push(...refusLecture.map(r => ({ url: null, fichier: r.fichier, raison: r.raison })));
    plan.denominateurs.refusees = plan.refus.length; plan.denominateurs.entrees += refusLecture.length;
    const d = plan.denominateurs;
    log(`   DÉNOMINATEURS : ${d.entrees} entrée(s) · à écrire ${d.aEcrire} · déjà au cache ${d.dejaAuCache} · refusées ${d.refusees}`);
    for (const r of plan.refus.slice(0, 10)) log(`   ✗ ${r.fichier ?? r.url} : ${r.raison}`);
    if (!argv.includes('--ecrire')) { log('   (simulation — rien n\'est écrit ; --ecrire --attendu=N écrit)'); return 0; }
    if (Number(arg('attendu')) !== d.aEcrire) { err(`❌ --attendu=${arg('attendu')} mais ${d.aEcrire} image(s) à écrire — rien n'est écrit`); return 1; }
    if (plan.refus.length) { err(`❌ ${plan.refus.length} refus : le lot doit être EXACTEMENT celui de la simulation — rien n'est écrit`); return 1; }
    const r = await ecrire({ plan, cache });
    log(`   ✅ écrites ${r.ecrites} · relues à l'identique ${r.relues}`);
    return r.ecrites === r.relues && r.ecrites === d.aEcrire ? 0 : 1;
}

module.exports = { lireDossier, lireManifeste, planifier, ecrire, verifierArguments, executer, sha256De };
if (require.main === module) executer({ argv: process.argv.slice(2) }).then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
