// ============================================================
// ANCIENS NOMS DE HONG KONG : RÉCOLTE 52poke (une page par espèce) ET CROISEMENT (2026-10-31, décision de l'éditeur)
// ============================================================
//   node recolter-anciens-noms-hk.js --source=52poke [--sortie=<dossier>] [--especes=<JALON-GEMPACK.json>] [--plafond=30]
//   node recolter-anciens-noms-hk.js --croiser [--sortie=<dossier>]        (aucun réseau : croise source-52poke.json et source-zhwiki.json -> anciens-noms-hk.json)
//   NODE_PATH = node_modules du dépôt principal. Aucune base, aucune variable d'environnement.
// LES GARDES (par ce qu'elles AUTORISENT) :
//   · UN SEUL hôte par lancement, wiki.52poke.com, et la forme d'adresse /wiki/<titre> (+ /robots.txt) ; le client LÈVE avant toute requête sur autre chose ;
//   · robots.txt LU avant (200 attendu) et respecté : son Crawl-delay (500 s chez 52poke) est la cadence — le client REFUSE de démarrer si la cadence est plus courte que le délai demandé ;
//   · ⚠️ le client ne tient la cadence qu'À L'INTÉRIEUR d'un processus : ce script relit donc le JOURNAL des requêtes (journal-requetes.jsonl) et attend le reste du délai avant une requête réseau,
//     même après un relancement (une réponse déjà au cache n'attend pas et ne coûte aucune requête) ;
//   · RH.garderHote avant chaque requête (le client) ; premier 401/403/410/429/défi -> RH.arretHote (dossier arrets-hotes), code 3, plus aucune requête ;
//   · les titres des pages viennent des libellés Wikidata (zh-hans) des espèces à instruire — jamais d'un nom de produit Cardmarket ; le n° de Pokédex est lu SUR LA PAGE et doit être celui attendu.
// zh.wikipedia.org : l'hôte est à l'arrêt (marqueur « captcha » sur sa première page, 2026-10-31) — aucun lecteur n'est écrit sans extrait réel, et ce script ne le contacte pas.
// CODES : 0 ok · 2 usage/configuration · 3 arrêt d'hôte · 4 erreur ou plafond · 5 page refusée (n° inattendu, tableau absent).
'use strict';
const fs = require('fs');
const path = require('path');
const RH = require('./collecte-cartes/reponse-hote');
const RC = require('./collecte-cartes/recolte-hote');
const T = require('./collecte-cartes/tpc');
const A = require('./collecte-cartes/anciens-noms-hk');

const DEFAUT = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT-31/FICHES-SET/anciens-noms-hk';
const ESPECES_DEFAUT = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/AUDIT-31/FICHES-SET/wikidata/JALON-GEMPACK.json';
const SOURCES = { '52poke': { hote: '52poke', hoteReseau: 'wiki.52poke.com', licence: 'CC BY-NC-SA 3.0', delaiMs: 500000, lecteur: A.lirePage52poke } };
const AUTORISES = [/^--source=52poke$/, /^--croiser$/, /^--sortie=.+$/, /^--especes=.+$/, /^--plafond=\d+$/];

const urlDe = (hote, titre) => `https://${hote}/wiki/${encodeURIComponent(titre.replace(/ /g, '_')).replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%28/g, '(').replace(/%29/g, ')')}`;
const ecrireAtomique = (f, texte) => { const tmp = `${f}.tmp-${process.pid}`; fs.writeFileSync(tmp, texte); fs.renameSync(tmp, f); };
const lireJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));

/** Le dernier instant d'une requête RÉSEAU vers cet hôte, d'après le journal du client (null si aucune). */
function derniereRequete(journal, hote) {
    if (!fs.existsSync(journal)) return null;
    let d = null;
    for (const l of fs.readFileSync(journal, 'utf8').split('\n')) { if (!l.trim()) continue; try { const j = JSON.parse(l); if (j.hote === hote) d = Math.max(d ?? 0, Date.parse(j.le)); } catch { /* ligne illisible : ignorée */ } }
    return d;
}

async function croiser(A_, sortie) {
    const lire = n => { const f = path.join(sortie, `source-${n}.json`); return fs.existsSync(f) ? lireJson(f) : null; };
    const s = n => { const j = lire(n); return j ? { source: j.source, licence: j.licence, luLe: j.luLe, parDex: j.parDex } : null; };
    const r = A.croiserAnciensNomsHk(s('52poke'), s('zhwiki'));
    ecrireAtomique(path.join(sortie, 'anciens-noms-hk.json'), JSON.stringify(A.versFichier(r), null, 1));
    console.log(`${r.message} -> ${path.join(sortie, 'anciens-noms-hk.json')}`);
    return 0;
}

/** `dep` (bancs seulement) : transport, dossierPauses, pause, now. */
async function main(argv, dep = {}) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} (une ligne de commande s'écrit par ce qu'elle autorise)`); return 2; }
    const v = n => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : undefined; };
    const sortie = v('sortie') || DEFAUT;
    fs.mkdirSync(sortie, { recursive: true });
    if (argv.includes('--croiser')) return croiser(A, sortie);
    const S = SOURCES[v('source')];
    if (!S) { console.error('❌ --source=52poke ou --croiser attendu'); return 2; }
    const now = dep.now || Date.now, pause = dep.pause || (ms => new Promise(r => setTimeout(r, ms))), dossierPauses = dep.dossierPauses || RH.DOSSIER_PAUSES;
    let especes;
    try { especes = lireJson(v('especes') || ESPECES_DEFAUT).especes.map(e => ({ dex: e.dex, titre: (e.labels || {})['zh-hans'], en: e.en })); } catch (e) { console.error(`❌ liste des espèces illisible (${e.message})`); return 2; }
    if (!especes.length || !especes.every(e => Number.isInteger(e.dex) && e.titre)) { console.error('❌ liste des espèces : un n° et un titre zh-hans par espèce sont obligatoires'); return 2; }

    try { RH.garderHote(S.hoteReseau, dossierPauses); } catch (e) { console.error(`❌ ARRÊT D'HÔTE EN VIGUEUR : ${e.message}`); return 3; }
    const journal = path.join(sortie, 'journal-requetes.jsonl'), cache = path.join(sortie, 'cache', S.hoteReseau);
    const client = RC.fabriquerClient({
        racine: S.hoteReseau, hotes: { [S.hoteReseau]: { chemin: /^\/(robots\.txt|wiki\/[^?#]+)$/, racine: S.hoteReseau } },
        dossierCache: cache, plafond: v('plafond') === undefined ? 30 : Number(v('plafond')), cadenceMs: S.delaiMs, journal, dossierPauses,
        now, pause, ...(dep.transport ? { transport: dep.transport } : {})
    });
    const sortieCode = c => { client.liberer(); console.log(`requêtes réseau de ce lancement : ${client.requetes()} · codes ${JSON.stringify(client.codes())} · code ${c}`); return c; };
    const attendre = async url => {      // la cadence entre processus : le reste du délai depuis la dernière requête RÉSEAU de l'hôte (journal)
        if (fs.existsSync(path.join(cache, RC.nomCache(url)))) return;
        const d = derniereRequete(journal, S.hoteReseau);
        if (d != null && d + S.delaiMs - now() > 0) { const reste = d + S.delaiMs - now(); console.log(`(Crawl-delay de ${S.hoteReseau} : attente de ${Math.ceil(reste / 1000)} s)`); await pause(reste); }
    };
    try {
        await attendre(`https://${S.hoteReseau}/robots.txt`);
        const r = await client.initialiserRobots(S.hoteReseau);
        if (r.statut !== 'present') { console.error('❌ robots.txt non lu (absent) : on ne peut pas conclure'); return sortieCode(2); }
        const pages = [], parDex = {};
        let refus = 0;
        for (const e of especes) {
            const url = urlDe(S.hoteReseau, e.titre);
            if (!T.autoriseParRobots(r.texte, new URL(url).pathname, RC.UA)) { console.error(`❌ robots.txt interdit ${url}`); return sortieCode(2); }
            await attendre(url);
            const rep = await client.lire(url);
            const p = rep.status === 200 ? S.lecteur(rep.texte) : { ok: false, raison: `HTTP ${rep.status}` };
            const bon = p.ok && p.dex === e.dex;
            if (!bon) refus++;
            pages.push({ dex: e.dex, titre: e.titre, url, le: rep.le, ok: bon, ...(p.ok ? { dexLu: p.dex, hk: p.hk } : {}), ...(bon ? {} : { raison: p.ok ? `la page porte le n° ${p.dex}, pas ${e.dex}` : p.raison }) });
            if (bon && p.hk.length) parDex[e.dex] = p.hk;
            console.log(`${e.dex} ${e.titre} : ${bon ? 'ok ' + JSON.stringify(p.hk) : 'REFUSÉE — ' + pages[pages.length - 1].raison}${rep.cache ? ' (cache)' : ''}`);
        }
        const luLe = pages.map(p => p.le).sort().pop().slice(0, 10);
        ecrireAtomique(path.join(sortie, `source-${S.hote}.json`), JSON.stringify({ source: S.hote, hote: S.hoteReseau, licence: S.licence, luLe, pages, parDex }, null, 1));
        return sortieCode(refus ? 5 : 0);
    } catch (e) {
        console.error(`❌ ${e.bloque ? 'ARRÊT D\'HÔTE : ' : ''}${e.message}`);
        return sortieCode(e.bloque ? 3 : 4);
    }
}

module.exports = { main, urlDe, derniereRequete };
if (require.main === module) main(process.argv.slice(2)).then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e && e.stack || e); process.exitCode = 4; });
