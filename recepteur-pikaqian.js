// ============================================================
// RÉCEPTEUR PASSIF DE PIKAQIAN — reçoit la page de set que LE TESTEUR a ouverte lui-même (2026-10-12)
// ============================================================
//   node recepteur-pikaqian.js [--port=8765] [--dossier=<chemin>]
//
// 🔑 DÉCISION DU TESTEUR (2026-10-12) : « PikaQian suspendue au 3e blocage : pas d'arrêt définitif. Prépare un script PASSIF sur le modèle de celui de
// Cardmarket (bouton « Apprendre cette page » sur les pages de set que J'OUVRE MOI-MÊME, aucune navigation automatique) qui envoie carte, numéro et
// adresse d'image. Prépare-le seulement, sans le lancer. »
//
// Ce programme ne fait AUCUNE requête réseau : il écoute 127.0.0.1 (jamais une autre adresse, et l'hôte n'est pas réglable), reçoit ce que le userscript
// (userscript-pikaqian.js) envoie au clic, le lit avec les fonctions de PRODUCTION (collecte-cartes/pikaqian.js : lireTuiles, lireOrigines, verdictDePage,
// compterAncresCartes — jamais une copie) et écrit UN fichier par page apprise. Aucune base, aucun secret. Le HTML n'est pas gardé : son sha256 seulement.
//
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (rien d'autre ne passe) — et elle ne DÉPEND PAS d'un en-tête que Tampermonkey pourrait ne pas transmettre :
//   · méthode POST, chemin exactement /apprendre (ni requête, ni barre finale) ;
//   · Host exactement 127.0.0.1:<port> ou localhost:<port> (contre le rebinding DNS) ;
//   · Content-Type application/json OBLIGATOIRE : une page web ne peut pas l'envoyer à un autre site sans PRÉVOL (OPTIONS), et OPTIONS reste 405, sans
//     en-tête CORS ni autorisation d'accès au réseau privé ;
//   · l'en-tête fixe `X-Rat-Market: rat-market-passif` que pose le userscript (même effet : un en-tête personnalisé impose le prévol) ;
//   · Origin : seulement https://pikaqian.com, ABSENTE (un navigateur l'ajoute toujours à un POST de page : l'absence prouve un client hors page), ou celle
//     d'une extension (chrome-extension://, moz-extension://) — toute autre origine web, et « null », sont refusées ;
//   · corps ≤ PAGE_MAX_OCTETS (pikaqian.js), compté sur la déclaration ET sur le flux reçu ;
//   · un objet JSON de DEUX clés exactement, url et html (chaînes) ;
//   · url == urlSet(code) de pikaqian.js pour un code du motif CODE_PK ;
//   · verdictDePage ok : la majorité stricte des tuiles porte le code du set ;
//   · la page est COMPLÈTE : autant de tuiles lues que d'ancres de cartes (sinon 422 « page partielle »), et au moins le nombre de tuiles que la mesure
//     du set a relevé quand la table le connaît (sinon 422 « page incomplète ») — une page refusée n'est jamais écrite, donc jamais mesurée.
// Chaque garde porte la marque « GARDE:<nom> » : rouge-recepteur-pikaqian.js retire les gardes une à une et exige que le banc échoue.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const P = require('./collecte-cartes/pikaqian');
const { TABLE_PIKAQIAN } = require('./collecte-cartes/pikaqian-sets');

const HOTE = '127.0.0.1';
const PORT_DEFAUT = 8765;          // = PORT du userscript (userscript-pikaqian.js, en tête) : les deux changent ensemble
const ORIGINE_ATTENDUE = `https://${P.HOTE_PAGES}`;
const ORIGINE_EXTENSION = /^(chrome|moz)-extension:\/\/[A-Za-z0-9-]+$/;
const ENTETE_MARQUE = 'x-rat-market', VALEUR_MARQUE = 'rat-market-passif';
const DOSSIER_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pikaqian\\apprises';
const PREFIXE_URL = `https://${P.HOTE_PAGES}/sets/`;
// ce que la page de Remix hydratée porte de son flux de données : s'il manque, `lireOrigines` ne peut rien lire (PIKAQIAN-PASSIF.md)
const MARQUEURS_FLUX = /__reactRouterContext|__remixContext|streamController\s*\.\s*enqueue|"loaderData"/;

const dansLeDepot = dossier => {
    const rel = path.relative(__dirname.toLowerCase(), path.resolve(dossier).toLowerCase());
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const horodatage = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/** Le nombre de tuiles que la mesure du set a relevé (pikaqian-sets.json, `tuiles`), ou null quand la table ne le connaît pas. */
const attenduParTable = code => TABLE_PIKAQIAN.filter(l => l.codePk === code && Number.isInteger(l.tuiles)).reduce((m, l) => Math.max(m, l.tuiles), 0) || null;

/** Écrit la fiche sans jamais écraser un fichier existant (un apprentissage de plus = un fichier de plus). */
function ecrireFiche(dossier, fiche) {
    const base = `${fiche.code}--${horodatage(new Date(fiche.le))}`;
    for (let i = 0; i < 100; i++) {
        const nom = `${base}${i ? `-${i + 1}` : ''}.json`;
        const cible = path.join(dossier, nom), tmp = `${cible}.tmp`;
        if (fs.existsSync(cible)) continue;
        fs.writeFileSync(tmp, JSON.stringify(fiche), { flag: 'wx' });
        fs.renameSync(tmp, cible);
        return nom;
    }
    throw new Error('plus de 100 fichiers pour la même seconde');
}

/**
 * Le JUGEMENT d'un corps lu : pur, rend { statut, corps, fiche? }. `html` n'est jamais gardé. `attendu(code)` : le nombre de tuiles attendu, ou null.
 */
function jugerPage(brut, { attendu = attenduParTable } = {}) {
    let o;
    try { o = JSON.parse(brut); } catch { return { statut: 400, corps: { ok: false, motif: 'corps illisible : ce n\'est pas du JSON' } }; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { statut: 400, corps: { ok: false, motif: 'le corps doit être un objet JSON' } };   // GARDE:objet
    const cles = Object.keys(o).sort().join(',');
    if (cles !== 'html,url') return { statut: 400, corps: { ok: false, motif: `clés reçues « ${cles} » : seules url et html sont acceptées` } };   // GARDE:cles
    if (typeof o.url !== 'string' || typeof o.html !== 'string') return { statut: 400, corps: { ok: false, motif: 'url et html doivent être des chaînes' } };   // GARDE:types
    const code = o.url.startsWith(PREFIXE_URL) ? o.url.slice(PREFIXE_URL.length) : null;
    let attendue = null;
    try { if (code && P.CODE_PK.test(code)) attendue = P.urlSet(code); } catch { /* hors motif */ }
    if (attendue !== o.url) return { statut: 422, corps: { ok: false, motif: `adresse « ${o.url.slice(0, 120)} » : ce n'est pas la page d'un set (${PREFIXE_URL}<code>)` } };   // GARDE:url
    const tuiles = P.lireTuiles(o.html);
    const ancres = P.compterAncresCartes(o.html);
    const verdict = P.verdictDePage({ tuiles, code });
    if (!verdict.ok) return { statut: 422, corps: { ok: false, code, motif: verdict.motif, tuilesLues: verdict.tuiles, tuilesAuCode: verdict.bonnes, ancres } };   // GARDE:verdict
    if (ancres > tuiles.length) return { statut: 422, corps: { ok: false, code, motif: `page partielle ou forme changée : ${ancres} ancres, ${tuiles.length} tuiles`, tuilesLues: tuiles.length, ancres } };   // GARDE:ancres
    const voulu = attendu(code);
    if (voulu && tuiles.length < voulu) return { statut: 422, corps: { ok: false, code, motif: `page incomplète : ${tuiles.length} tuiles lues, ${voulu} relevées pour ce set à la mesure`, tuilesLues: tuiles.length, ancres, attendu: voulu } };   // GARDE:incomplete
    const origines = [...P.lireOrigines(o.html)];
    const officielles = origines.filter(([, v]) => v.officielle).length;
    // « flux absent » (aucun bloc de données de Remix dans la page : ANOMALIE) ≠ « flux présent, 0 adresse officielle » (le résultat normal : 1 sur 315)
    const flux = origines.length || MARQUEURS_FLUX.test(o.html) ? 'present' : 'absent';
    const anomalie = flux === 'absent' ? 'FLUX DE DONNÉES ABSENT : aucun bloc de données Remix trouvé dans la page — les adresses officielles ne peuvent pas être lues (page non hydratée ? forme changée ?). À signaler.' : null;
    const fiche = {
        schema: 1, code, url: o.url, le: new Date().toISOString(),
        sha256: crypto.createHash('sha256').update(o.html).digest('hex'), octetsHtml: Buffer.byteLength(o.html),
        verdict, ancres, tuilesLues: tuiles.length, tuilesAuCode: verdict.bonnes, flux, tuiles, origines, officielles
    };
    return { statut: 200, fiche, corps: { ok: true, code, ancres, tuilesLues: tuiles.length, tuilesAuCode: verdict.bonnes, flux, officielles, natives: origines.filter(([, v]) => v.native).length, ...(anomalie ? { anomalie } : {}) } };
}

/**
 * Démarre le récepteur. `port: 0` = éphémère (les bancs). `hote` n'existe pas : 127.0.0.1 seulement. `attendu` n'existe que pour les bancs.
 * @returns {Promise<{port:number, adresse:string, fermer:()=>Promise<void>}>}
 */
async function demarrer({ port = PORT_DEFAUT, dossier = DOSSIER_DEFAUT, maxOctets = P.PAGE_MAX_OCTETS, attendu = attenduParTable, journal = m => console.log(m) } = {}) {
    if (!Number.isFinite(maxOctets) || maxOctets <= 0) throw new Error(`plafond de corps illisible (${maxOctets}) : PAGE_MAX_OCTETS de pikaqian.js doit être un nombre`);
    if (dansLeDepot(dossier)) throw new Error(`le dossier « ${dossier} » est dans le dépôt : les pages apprises n'y entrent jamais`);
    fs.mkdirSync(dossier, { recursive: true });
    const serveur = http.createServer((req, res) => {
        const repondre = (statut, corps) => {
            const t = JSON.stringify(corps);
            res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(t), Connection: 'close', 'Cache-Control': 'no-store' });
            res.end(t);
        };
        const refuser = (statut, motif) => { journal(`⛔ ${statut} ${req.method} ${String(req.url).slice(0, 80)} : ${motif}`); repondre(statut, { ok: false, motif }); };
        const { port: portReel } = serveur.address() || {};
        const origine = req.headers.origin;
        if (req.method !== 'POST') return refuser(405, 'seule la méthode POST est acceptée');   // GARDE:methode
        if (req.url !== '/apprendre') return refuser(404, 'seul le chemin /apprendre existe');   // GARDE:chemin
        if (req.headers.host !== `${HOTE}:${portReel}` && req.headers.host !== `localhost:${portReel}`) return refuser(403, 'Host refusé');   // GARDE:host
        if (!(origine === undefined || origine === ORIGINE_ATTENDUE || ORIGINE_EXTENSION.test(origine))) return refuser(403, `Origin « ${String(origine).slice(0, 60)} » refusée (seules ${ORIGINE_ATTENDUE}, l'absence d'Origin et une origine d'extension passent)`);   // GARDE:origine
        if (req.headers[ENTETE_MARQUE] !== VALEUR_MARQUE) return refuser(403, `en-tête ${ENTETE_MARQUE} absent ou différent de ${VALEUR_MARQUE}`);   // GARDE:entete
        if (!/^application\/json(\s*;.*)?$/i.test(req.headers['content-type'] || '')) return refuser(415, 'Content-Type application/json exigé');   // GARDE:contenttype
        const declare = Number(req.headers['content-length']);
        if (declare > maxOctets) return refuser(413, `corps de ${declare} octets : au-delà de ${maxOctets}`);   // GARDE:taille-declaree
        const morceaux = []; let total = 0, trop = false;
        req.on('data', c => {
            if (trop) return;
            total += c.length;
            if (total > maxOctets) { trop = true; morceaux.length = 0; refuser(413, `corps de plus de ${maxOctets} octets`); setTimeout(() => req.destroy(), 50); return; }   // GARDE:taille-flux
            morceaux.push(c);
        });
        req.on('error', () => { /* coupure : rien à écrire */ });
        req.on('end', () => {
            if (trop) return;
            try {
                const j = jugerPage(Buffer.concat(morceaux).toString('utf8'), { attendu });
                if (j.statut !== 200) { journal(`⛔ ${j.statut} page refusée : ${j.corps.motif}${j.corps.ancres != null ? ` (ancres ${j.corps.ancres}, tuiles ${j.corps.tuilesLues ?? '?'})` : ''}`); return repondre(j.statut, j.corps); }
                const nom = ecrireFiche(dossier, j.fiche);
                journal(`✅ ${j.fiche.code} : ${j.fiche.ancres} ancres, ${j.fiche.tuilesLues} tuiles lues, ${j.fiche.tuilesAuCode} au code du set, flux ${j.fiche.flux}, ${j.fiche.officielles} adresse(s) officielle(s) déclarée(s) → ${nom}${j.corps.anomalie ? `\n   ⚠️ ${j.corps.anomalie}` : ''}`);
                repondre(200, { ...j.corps, fichier: nom });
            } catch (e) { journal(`🔴 erreur interne : ${e.message}`); repondre(500, { ok: false, motif: 'erreur interne du récepteur' }); }
        });
    });
    serveur.requestTimeout = 30000;
    await new Promise((ok, ko) => { serveur.once('error', ko); serveur.listen(port, HOTE, ok); });
    const a = serveur.address();
    return { port: a.port, adresse: a.address, fermer: () => new Promise(ok => { serveur.close(() => ok()); serveur.closeAllConnections?.(); }) };
}

module.exports = { demarrer, jugerPage, ecrireFiche, dansLeDepot, attenduParTable, HOTE, PORT_DEFAUT, ORIGINE_ATTENDUE, ENTETE_MARQUE, VALEUR_MARQUE, DOSSIER_DEFAUT };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main === module) {
    // La ligne de commande s'écrit par ce qu'elle AUTORISE : un argument inconnu refuse avant d'écouter.
    const args = process.argv.slice(2);
    const AUTORISES = [/^--port=(\d{4,5})$/, /^--dossier=.+$/];
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    const port = Number(args.find(a => a.startsWith('--port='))?.slice(7) ?? PORT_DEFAUT);
    if (inconnus.length || !(port >= 1024 && port <= 65535)) {
        console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}permis : --port=<1024-65535> (défaut ${PORT_DEFAUT}, = PORT du userscript : si tu le changes ici, change-le aussi en tête de userscript-pikaqian.js), --dossier=<chemin> (hors du dépôt). Le récepteur n'écoute que ${HOTE}.`);
        process.exit(2);
    }
    const dossier = args.find(a => a.startsWith('--dossier='))?.slice(10) ?? DOSSIER_DEFAUT;
    demarrer({ port, dossier }).then(s => {
        console.log(`Récepteur PikaQian : http://${s.adresse}:${s.port}/apprendre — dossier ${dossier} — Ctrl+C pour arrêter. Aucune requête sortante.`);
    }).catch(e => { console.error('❌', e.message); process.exit(1); });
}
