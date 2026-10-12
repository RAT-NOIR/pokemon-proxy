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
// (userscript-pikaqian.js) envoie au clic, le lit avec les fonctions de PRODUCTION (collecte-cartes/pikaqian.js : lireTuiles, lireOrigines, verdictDePage —
// jamais une copie) et écrit UN fichier par page apprise. Aucune base, aucun secret. Le HTML n'est pas gardé : seuls son sha256 et ce qu'on en a lu.
//
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (rien d'autre ne passe) :
//   · méthode POST, chemin exactement /apprendre (ni requête, ni barre finale) ;
//   · Host exactement 127.0.0.1:<port> ou localhost:<port> (contre le rebinding DNS) ;
//   · Origin exactement https://pikaqian.com — n'importe quel site ouvert dans le navigateur peut viser 127.0.0.1, et c'est la seule trace de qui parle ;
//   · Content-Type application/json ;
//   · corps ≤ PAGE_MAX_OCTETS (pikaqian.js), compté sur le flux reçu et non sur la déclaration ;
//   · un objet JSON de DEUX clés exactement, url et html (chaînes) — toute autre clé est refusée ;
//   · url == urlSet(code) de pikaqian.js pour un code du motif CODE_PK ;
//   · verdictDePage ok : la majorité stricte des tuiles porte le code du set.
// Le dossier d'écriture ne peut pas être dans le dépôt.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const P = require('./collecte-cartes/pikaqian');

const HOTE = '127.0.0.1';
const PORT_DEFAUT = 8765;
const ORIGINE_ATTENDUE = `https://${P.HOTE_PAGES}`;
const DOSSIER_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pikaqian\\apprises';
const CODE_DANS_URL = /^https:\/\/pikaqian\.com\/sets\/([a-z0-9][a-z0-9.-]{0,30})$/;

const dansLeDepot = dossier => {
    const rel = path.relative(__dirname.toLowerCase(), path.resolve(dossier).toLowerCase());
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const horodatage = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

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
 * Le JUGEMENT d'une requête dont le corps est lu : pur, rend { statut, corps, fiche? }. `html` n'est jamais gardé.
 */
function jugerPage(brut) {
    let o;
    try { o = JSON.parse(brut); } catch { return { statut: 400, corps: { ok: false, motif: 'corps illisible : ce n\'est pas du JSON' } }; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { statut: 400, corps: { ok: false, motif: 'le corps doit être un objet JSON' } };
    const cles = Object.keys(o).sort().join(',');
    if (cles !== 'html,url') return { statut: 400, corps: { ok: false, motif: `clés reçues « ${cles} » : seules url et html sont acceptées` } };
    if (typeof o.url !== 'string' || typeof o.html !== 'string') return { statut: 400, corps: { ok: false, motif: 'url et html doivent être des chaînes' } };
    const code = CODE_DANS_URL.exec(o.url)?.[1];
    let attendue = null;
    try { if (code) attendue = P.urlSet(code); } catch { /* hors motif */ }
    if (!code || attendue !== o.url) return { statut: 422, corps: { ok: false, motif: `adresse « ${o.url.slice(0, 120)} » : ce n'est pas la page d'un set (https://${P.HOTE_PAGES}/sets/<code>)` } };
    const tuiles = P.lireTuiles(o.html);
    const verdict = P.verdictDePage({ tuiles, code });
    if (!verdict.ok) return { statut: 422, corps: { ok: false, code, motif: verdict.motif, tuilesLues: verdict.tuiles, tuilesAuCode: verdict.bonnes } };
    const origines = [...P.lireOrigines(o.html)];
    const officielles = origines.filter(([, v]) => v.officielle).length;
    const fiche = {
        schema: 1, code, url: o.url, le: new Date().toISOString(),
        sha256: crypto.createHash('sha256').update(o.html).digest('hex'), octetsHtml: Buffer.byteLength(o.html),
        verdict, tuilesLues: tuiles.length, tuilesAuCode: verdict.bonnes, tuiles, origines, officielles
    };
    return { statut: 200, fiche, corps: { ok: true, code, tuilesLues: tuiles.length, tuilesAuCode: verdict.bonnes, officielles, natives: origines.filter(([, v]) => v.native).length } };
}

/**
 * Démarre le récepteur. `port: 0` = éphémère (les bancs). `hote` n'existe pas : 127.0.0.1 seulement.
 * @returns {Promise<{port:number, adresse:string, fermer:()=>Promise<void>}>}
 */
async function demarrer({ port = PORT_DEFAUT, dossier = DOSSIER_DEFAUT, maxOctets = P.PAGE_MAX_OCTETS, journal = m => console.log(m) } = {}) {
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
        if (req.method !== 'POST') return refuser(405, 'seule la méthode POST est acceptée');
        if (req.url !== '/apprendre') return refuser(404, 'seul le chemin /apprendre existe');
        if (req.headers.host !== `${HOTE}:${portReel}` && req.headers.host !== `localhost:${portReel}`) return refuser(403, 'Host refusé');
        if (req.headers.origin !== ORIGINE_ATTENDUE) return refuser(403, `Origin refusée (seule ${ORIGINE_ATTENDUE} est acceptée)`);
        if (!/^application\/json(\s*;.*)?$/i.test(req.headers['content-type'] || '')) return refuser(415, 'Content-Type application/json exigé');
        const declare = Number(req.headers['content-length']);
        if (declare > maxOctets) return refuser(413, `corps de ${declare} octets : au-delà de ${maxOctets}`);
        const morceaux = []; let total = 0, trop = false;
        req.on('data', c => {
            if (trop) return;
            total += c.length;
            if (total > maxOctets) { trop = true; morceaux.length = 0; refuser(413, `corps de plus de ${maxOctets} octets`); setTimeout(() => req.destroy(), 50); return; }
            morceaux.push(c);
        });
        req.on('error', () => { /* coupure : rien à écrire */ });
        req.on('end', () => {
            if (trop) return;
            try {
                const j = jugerPage(Buffer.concat(morceaux).toString('utf8'));
                if (j.statut !== 200) { journal(`⛔ ${j.statut} page refusée : ${j.corps.motif}`); return repondre(j.statut, j.corps); }
                const nom = ecrireFiche(dossier, j.fiche);
                journal(`✅ ${j.fiche.code} : ${j.fiche.tuilesLues} tuiles lues, ${j.fiche.tuilesAuCode} au code du set, ${j.fiche.officielles} adresse(s) officielle(s) déclarée(s) → ${nom}`);
                repondre(200, { ...j.corps, fichier: nom });
            } catch (e) { journal(`🔴 erreur interne : ${e.message}`); repondre(500, { ok: false, motif: 'erreur interne du récepteur' }); }
        });
    });
    serveur.requestTimeout = 30000;
    await new Promise((ok, ko) => { serveur.once('error', ko); serveur.listen(port, HOTE, ok); });
    const a = serveur.address();
    return { port: a.port, adresse: a.address, fermer: () => new Promise(ok => { serveur.close(() => ok()); serveur.closeAllConnections?.(); }) };
}

module.exports = { demarrer, jugerPage, ecrireFiche, dansLeDepot, HOTE, PORT_DEFAUT, ORIGINE_ATTENDUE, DOSSIER_DEFAUT };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main === module) {
    // La ligne de commande s'écrit par ce qu'elle AUTORISE : un argument inconnu refuse avant d'écouter.
    const args = process.argv.slice(2);
    const AUTORISES = [/^--port=(\d{4,5})$/, /^--dossier=.+$/];
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    const port = Number(args.find(a => a.startsWith('--port='))?.slice(7) ?? PORT_DEFAUT);
    if (inconnus.length || !(port >= 1024 && port <= 65535)) {
        console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}permis : --port=<1024-65535> (défaut ${PORT_DEFAUT}), --dossier=<chemin> (hors du dépôt). Le récepteur n'écoute que ${HOTE}.`);
        process.exit(2);
    }
    const dossier = args.find(a => a.startsWith('--dossier='))?.slice(10) ?? DOSSIER_DEFAUT;
    demarrer({ port, dossier }).then(s => {
        console.log(`Récepteur PikaQian : http://${s.adresse}:${s.port}/apprendre — dossier ${dossier} — Ctrl+C pour arrêter. Aucune requête sortante.`);
    }).catch(e => { console.error('❌', e.message); process.exit(1); });
}
