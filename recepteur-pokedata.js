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
    if (!d || typeof d !== 'object' || Array.isArray(d) || cles(d) !== 'complet,exemples,imgs') return non(400, 'diag : clés exactes complet,exemples,imgs exigées');
    if (typeof d.complet !== 'boolean' || !Number.isInteger(d.imgs) || !Array.isArray(d.exemples) || d.exemples.length > 5 || !d.exemples.every(x => estChaine(x, 3000))) return non(400, 'diag : complet booléen, imgs entier, au plus 5 exemples de 3000 caractères');
    return { ok: true };
}

const slugFichier = s => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const horodatage = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/** Le serveur (non démarré). `dossier` : où écrire. */
function creerServeur({ dossier = DOSSIER_DEFAUT } = {}) {
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
            let o; try { o = JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch { return fin(400, 'JSON illisible'); }
            const v = validerReleve(o);
            if (!v.ok) return fin(v.statut, v.motif);
            fs.mkdirSync(dossier, { recursive: true });
            const nom = slugFichier(o.set);
            fs.writeFileSync(path.join(dossier, `releve--${nom}.json`), JSON.stringify({ schema: 1, set: o.set, complet: o.diag.complet, le: new Date().toISOString(), cartes: o.cartes }, null, 1));
            fs.writeFileSync(path.join(dossier, `diag--${nom}--${horodatage()}.json`), JSON.stringify({ set: o.set, url: o.url, cartes: o.cartes.length, diag: o.diag }, null, 1));
            fin(200, `${o.cartes.length} carte(s) enregistrée(s) pour ${o.set}`);
        });
    });
}

module.exports = { validerReleve, creerServeur, HOTE, PORT_DEFAUT, ENTETE_MARQUE, VALEUR_MARQUE, DOSSIER_DEFAUT };

if (require.main !== module) return;
const arg = n => process.argv.slice(2).find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const inconnus = process.argv.slice(2).filter(a => !/^--(port|dossier)=.+$/.test(a));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exitCode = 2; }
else {
    const port = Number(arg('port') ?? PORT_DEFAUT);
    creerServeur({ dossier: arg('dossier') ?? DOSSIER_DEFAUT }).listen(port, HOTE, () => console.log(`récepteur sur http://${HOTE}:${port}/releve → ${arg('dossier') ?? DOSSIER_DEFAUT} (aucune requête sortante)`));
}
