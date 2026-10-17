// ============================================================
// RÉCEPTEUR PASSIF — reçoit le relevé de la page de set que LE TESTEUR a ouverte lui-même (lot POKEDATA, correction 1, 2026-10-17)
// ============================================================
//   node recepteur-pokedata.js [--port=8767] [--dossier=<chemin>]
//
// Ce programme ne fait AUCUNE requête réseau : il écoute 127.0.0.1 (l'hôte n'est pas réglable), reçoit ce que userscript-pokedata.user.js envoie au clic, valide le schéma
// (collecte-cartes/pokedata.js : adresses, sets), et écrit deux fichiers par page : releve--<set>.json (schéma 1, lu par le plan) et diag--<set>--<date>.json (la structure
// réelle de la page, pour régler le userscript). Aucune base, aucun R2.
// LES GARDES S'ÉCRIVENT PAR CE QU'ELLES AUTORISENT : POST, chemin /releve exact, Host exact, en-tête de marque, Content-Type JSON, Origin absente / du site / d'une extension,
// corps borné, clés exactes, adresses d'image valables ET du set déclaré (jamais _240w).
const fs = require('fs');
const path = require('path');
const http = require('http');
const P = require('./collecte-cartes/pokedata');
// mêmes gardes de chemin que recepteur-pokemoncom.js (liste blanche : UNE racine ; chemin RÉEL jugé, jonctions et liens résolus)
const { dansLeDepot, dansApportsManuels, dansRacineAutorisee, RACINE_AUTORISEE } = require('./recepteur-pikaqian');

const HOTE = '127.0.0.1';
const PORT_DEFAUT = 8767;
const ENTETE_MARQUE = 'X-Rat-Market';
const VALEUR_MARQUE = 'releve-passif';
const ORIGINE_SITE = 'https://www.pokedata.io';
const ORIGINE_EXTENSION = /^(chrome|moz)-extension:\/\/[A-Za-z0-9-]+$/;
const DOSSIER_DEFAUT = path.join(P.DOSSIER_CACHE, 'releves');
const CORPS_MAX_OCTETS = 1024 * 1024;
const CARTES_MAX = 1000;
const estChaine = (v, max) => typeof v === 'string' && v.length <= max;
const cles = o => Object.keys(o).sort().join(',');

/** Valide un relevé déjà lu en JSON. Rend { ok: true } ou { ok: false, statut, motif }. */
function validerReleve(o) {
    const non = (statut, motif) => ({ ok: false, statut, motif });
    if (!o || typeof o !== 'object' || Array.isArray(o)) return non(400, 'le corps doit être un objet JSON');
    if (o.schema !== 1) return non(400, `schéma ${o.schema} inconnu : seul le schéma 1 est accepté`);
    if (cles(o) !== 'cartes,diag,schema,set,url') return non(400, `clés reçues « ${cles(o).slice(0, 200)} » : seules cartes,diag,schema,set,url sont acceptées`);
    if (typeof o.set !== 'string' || !Object.hasOwn(P.SETS_UTILES, o.set)) return non(422, `set « ${String(o.set).slice(0, 80)} » hors de la table`);
    if (!P.urlPageValide(o.url) || P.nomDeSegment(new URL(o.url).pathname.replace(/^\/set\//, ''), Object.keys(P.SETS_UTILES)) !== o.set) return non(422, 'adresse de page : ce n\'est pas la page du set déclaré');
    if (!Array.isArray(o.cartes) || o.cartes.length > CARTES_MAX) return non(400, `cartes : un tableau de ${CARTES_MAX} cartes au plus`);
    for (let i = 0; i < o.cartes.length; i++) {
        const c = o.cartes[i];
        if (!c || typeof c !== 'object' || Array.isArray(c) || cles(c) !== 'img,nom,numero') return non(400, `carte ${i} : clés exactes img,nom,numero exigées`);
        if (!estChaine(c.nom, 200) || typeof c.numero !== 'string' || !/^[A-Za-z0-9-]{1,12}$/.test(c.numero)) return non(400, `carte ${i} : nom (200 caractères) et numéro [A-Za-z0-9-]{1,12} exigés`);
        if (!P.urlImageValide(c.img)) return non(422, `carte ${i} : adresse d'image hors des règles (hôte, chemin, jamais _240w)`);
        if (P.nomDeSegment(new URL(c.img).pathname.slice(P.PREFIXE_CHEMIN.length).split('/')[0]) !== o.set) return non(422, `carte ${i} : l'image n'est pas celle du set déclaré`);
    }
    const d = o.diag;
    if (!d || typeof d !== 'object' || Array.isArray(d) || cles(d) !== 'complet,imgs,structure') return non(400, 'diag : clés exactes complet,imgs,structure exigées');
    if (typeof d.complet !== 'boolean' || !Number.isInteger(d.imgs) || !Array.isArray(d.structure) || d.structure.length > 5 || !d.structure.every(x => estChaine(x, 300) && STRUCTURE.test(x))) return non(400, 'diag : complet booléen, imgs entier, au plus 5 chemins « BALISE.classe / … / IMG[src,alt] » de 300 caractères (aucun texte, aucun autre attribut)');
    return { ok: true };
}
// un résumé STRUCTUREL seulement : des balises (et leurs classes) de haut en bas, jusqu'à l'image ; jamais un texte, jamais un attribut autre que src/alt de l'image
const STRUCTURE = /^(?:[A-Z][A-Z0-9]*(?:\.[A-Za-z0-9_.-]*)? \/ ){0,4}IMG\[src,alt\]$/;
/** Le numéro porté par le nom de fichier d'une adresse d'image valable (« …/037a.webp » -> « 037a »). */
const numeroDuFichier = img => new URL(img).pathname.split('/').pop().replace(/\.webp$/, '');
/** Fusionne un relevé reçu dans le fichier existant du même set SANS PERTE : union par adresse, la lecture neuve l'emporte si son nom est non vide, « complet » ne redescend jamais. */
function fusionner(ancien, o) {
    const par = new Map();
    for (const c of ancien?.cartes ?? []) par.set(c.img, c);
    for (const c of o.cartes) {
        const fichier = numeroDuFichier(c.img);
        const neuve = { numero: fichier, nom: c.nom, img: c.img, ...(c.numero !== fichier ? { numeroDoute: true } : {}) };      // le numéro du fichier fait foi ; un numéro envoyé qui le contredit marque la carte douteuse
        const vieille = par.get(c.img);
        par.set(c.img, vieille && !neuve.nom ? { ...neuve, nom: vieille.nom } : neuve);
    }
    return { cartes: [...par.values()], complet: (ancien?.complet === true) || o.diag.complet === true };
}

const slugFichier = s => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const horodatage = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/** Le serveur (non démarré). `dossier` : où écrire. */
function creerServeur({ dossier = DOSSIER_DEFAUT, racine = RACINE_AUTORISEE } = {}) {
    if (dansLeDepot(dossier)) throw new Error(`le dossier « ${dossier} » est dans le dépôt : les relevés n'y entrent jamais`);
    if (!dansRacineAutorisee(dossier, racine)) throw new Error(`le dossier « ${dossier} » n'est pas sous la racine autorisée « ${racine} » : le récepteur n'écrit que là`);
    if (dansApportsManuels(dossier)) throw new Error(`le dossier « ${dossier} » est un dossier d'apports manuels (ou est dedans) : jamais écrit par un outil`);
    return http.createServer((req, res) => {
        const fin = (statut, texte) => { res.writeHead(statut, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' }); res.end(texte); req.resume(); };
        if (req.method !== 'POST') return fin(405, 'POST seulement');
        if (req.url !== '/releve') return fin(404, 'chemin inconnu');
        const hote = req.headers.host || '';
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(hote)) return fin(403, 'hôte refusé');
        if (req.headers[ENTETE_MARQUE.toLowerCase()] !== VALEUR_MARQUE) return fin(403, 'marque absente');
        const origine = req.headers.origin;
        if (origine !== undefined && origine !== ORIGINE_SITE && !ORIGINE_EXTENSION.test(origine)) return fin(403, 'origine refusée');
        if (!/^application\/json(\s*;|$)/i.test(req.headers['content-type'] || '')) return fin(415, 'JSON seulement');
        if (Number(req.headers['content-length'] || 0) > CORPS_MAX_OCTETS) return fin(413, 'corps trop gros');
        const morceaux = []; let taille = 0, trop = false;
        req.on('data', c => { taille += c.length; if (taille > CORPS_MAX_OCTETS) trop = true; else morceaux.push(c); });
        req.on('end', () => {
            if (trop) return fin(413, 'corps trop gros');
            try {
            let o; try { o = JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch { return fin(400, 'JSON illisible'); }
            const v = validerReleve(o);
            if (!v.ok) return fin(v.statut, v.motif);
            fs.mkdirSync(dossier, { recursive: true });
            const nom = slugFichier(o.set);
            let ancien = null; try { ancien = JSON.parse(fs.readFileSync(path.join(dossier, `releve--${nom}.json`), 'utf8')); } catch { /* premier relevé de ce set */ }
            const f = fusionner(ancien, o);
            fs.writeFileSync(path.join(dossier, `releve--${nom}.json`), JSON.stringify({ schema: 1, set: o.set, complet: f.complet, le: new Date().toISOString(), cartes: f.cartes }, null, 1));
            fs.writeFileSync(path.join(dossier, `diag--${nom}--${horodatage()}.json`), JSON.stringify({ set: o.set, url: o.url, cartes: o.cartes.length, diag: o.diag }, null, 1));
            fin(200, `${o.cartes.length} carte(s) enregistrée(s) pour ${o.set}`);
            } catch (e) { console.error(`récepteur : erreur interne (relevé existant corrompu ?) — ${e.message}`); if (!res.headersSent) fin(500, 'erreur interne : relevé existant illisible'); }
        });
    });
}

module.exports = { validerReleve, fusionner, creerServeur, HOTE, PORT_DEFAUT, ENTETE_MARQUE, VALEUR_MARQUE, DOSSIER_DEFAUT };

if (require.main !== module) return;
const arg = n => process.argv.slice(2).find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const inconnus = process.argv.slice(2).filter(a => !/^--(port|dossier)=.+$/.test(a));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exitCode = 2; }
else {
    const port = Number(arg('port') ?? PORT_DEFAUT);
    try {
        creerServeur({ dossier: arg('dossier') ?? DOSSIER_DEFAUT }).listen(port, HOTE, () => console.log(`récepteur sur http://${HOTE}:${port}/releve → ${arg('dossier') ?? DOSSIER_DEFAUT} (aucune requête sortante)`));
    } catch (e) { console.error(`❌ ${e.message}`); process.exitCode = 1; }
}
