// ============================================================
// RÉCEPTEUR PASSIF DE pokemon.com — reçoit le relevé de la page que LE TESTEUR a ouverte lui-même (lot PKMCOM-US, 2026-10-17)
// ============================================================
//   node recepteur-pokemoncom.js [--port=8766] [--dossier=<chemin>]
//
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : « pokemon.com, base de cartes : bloquée par Imperva pour le worker → méthode passive comme PikaQian (userscript au clic, pages
// ouvertes par moi seulement, aucune navigation automatique, aucun cookie réutilisé). »
//
// Ce programme ne fait AUCUNE requête réseau : il écoute 127.0.0.1 (l'hôte n'est pas réglable), reçoit ce que userscript-pokemoncom.js envoie au clic, valide le schéma
// du relevé, et écrit DEUX fichiers par page (page--<slug>--<date>.json et diag--<slug>--<date>.json), jamais écrasés. Aucune base, aucun R2, aucun importeur : l'importeur
// s'écrira sur la forme RÉELLE de la première page relevée. Il réutilise les gardes de chemin de recepteur-pikaqian.js (même racine, mêmes apports manuels exclus).
//
// LES GARDES S'ÉCRIVENT PAR CE QU'ELLES AUTORISENT :
//   · méthode POST, chemin exactement /releve ; Host exactement 127.0.0.1:<port> ou localhost:<port> ;
//   · en-tête fixe X-Rat-Market (impose le prévol à une page web ; OPTIONS reste 405, sans CORS) et Content-Type application/json ;
//   · Origin : seulement https://www.pokemon.com, ABSENTE, ou celle d'une extension ;
//   · corps ≤ CORPS_MAX_OCTETS, compté sur la déclaration ET sur le flux ;
//   · schéma : un objet de clés exactes, adresse = https://www.pokemon.com/us/pokemon-tcg/pokemon-cards…, longueurs bornées, cartes de clés exactes, images en https ;
//   · écriture : seulement sous la racine du chantier, jamais dans le dépôt, jamais dans un dossier d'apports manuels.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const PK = require('./recepteur-pikaqian');

const HOTE = '127.0.0.1';
const PORT_DEFAUT = 8766;            // = PORT du userscript : les deux changent ensemble (PikaQian garde 8765)
const ORIGINE_ATTENDUE = 'https://www.pokemon.com';
const HOTE_PAGES = 'www.pokemon.com';
const CHEMIN_BASE = '/us/pokemon-tcg/pokemon-cards';
const ORIGINE_EXTENSION = /^(chrome|moz)-extension:\/\/[A-Za-z0-9-]+$/;
const { ENTETE_MARQUE, VALEUR_MARQUE } = PK;
const DOSSIER_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pokemoncom-passif';
const CORPS_MAX_OCTETS = 2 * 1024 * 1024;
const HTML_MAX = 400000;             // caractères de la zone des résultats gardés par le userscript
const CARTES_MAX = 1000;
const { dansLeDepot, dansApportsManuels, dansRacineAutorisee, RACINE_AUTORISEE } = PK;

const CLES_RELEVE = 'cartes,compteur,filtre,html,htmlTronque,pagination,schema,titre,url,zoneRepli';
const CLES_CARTE = 'alt,img,nom,numero,set';
const estChaine = (v, max) => typeof v === 'string' && v.length <= max;
const horodatage = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

/** Valide le schéma d'un relevé déjà lu en JSON. Rend { ok: true } ou { ok: false, statut, motif }. Écrit par ce qu'il autorise. */
function validerReleve(o) {
    const non = (statut, motif) => ({ ok: false, statut, motif });
    if (!o || typeof o !== 'object' || Array.isArray(o)) return non(400, 'le corps doit être un objet JSON');   // GARDE:objet
    const cles = Object.keys(o).sort().join(',');
    if (cles !== CLES_RELEVE) return non(400, `clés reçues « ${cles.slice(0, 200)} » : seules ${CLES_RELEVE} sont acceptées`);   // GARDE:cles
    if (o.schema !== 1) return non(400, 'schema doit valoir 1');   // GARDE:schema
    let adresseOk = false;
    if (estChaine(o.url, 2000)) {
        try {
            const u = new URL(o.url);
            adresseOk = u.protocol === 'https:' && u.hostname === HOTE_PAGES && !u.port && !u.username && !u.password && !u.hash && (u.pathname === CHEMIN_BASE || u.pathname.startsWith(`${CHEMIN_BASE}/`));
        } catch { adresseOk = false; }
    }
    if (!adresseOk) return non(422, `adresse « ${String(o.url).slice(0, 120)} » : ce n'est pas une page de ${ORIGINE_ATTENDUE}${CHEMIN_BASE}`);   // GARDE:url
    if (!estChaine(o.titre, 300)) return non(400, 'titre : une chaîne de 300 caractères au plus');   // GARDE:titre
    if (!estChaine(o.compteur, 300)) return non(400, 'compteur : une chaîne de 300 caractères au plus');
    if (!estChaine(o.pagination, 500)) return non(400, 'pagination : une chaîne de 500 caractères au plus');
    if (!Array.isArray(o.filtre) || o.filtre.length > 20 || !o.filtre.every(x => estChaine(x, 200))) return non(400, 'filtre : au plus 20 chaînes de 200 caractères');   // GARDE:filtre
    if (!Array.isArray(o.cartes) || o.cartes.length > CARTES_MAX) return non(400, `cartes : un tableau de ${CARTES_MAX} cartes au plus`);   // GARDE:cartes
    for (let i = 0; i < o.cartes.length; i++) {
        const c = o.cartes[i];
        if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).sort().join(',') !== CLES_CARTE) return non(400, `carte ${i} : clés exactes ${CLES_CARTE} exigées`);   // GARDE:carte
        if (![c.nom, c.numero, c.set, c.alt].every(x => estChaine(x, 300)) || !estChaine(c.img, 1000)) return non(400, `carte ${i} : champs en chaînes bornées`);
        if (c.img !== '' && !/^https:\/\/[^\s]+$/.test(c.img)) return non(400, `carte ${i} : l'adresse d'image doit être vide ou en https`);   // GARDE:image
    }
    if (!estChaine(o.html, HTML_MAX)) return non(400, `html : une chaîne de ${HTML_MAX} caractères au plus`);   // GARDE:html
    if (typeof o.htmlTronque !== 'boolean') return non(400, 'htmlTronque doit être un booléen');   // GARDE:tronque
    if (typeof o.zoneRepli !== 'boolean') return non(400, 'zoneRepli doit être un booléen');   // GARDE:repli
    return { ok: true };
}

/** Le diagnostic d'un relevé : cartes vues, total annoncé lu dans le compteur affiché (ou null), complétude (null = on ne sait pas). */
function diagnostiquer(o) {
    const m = /(\d[\d.,]*)\s*(?:cards?|results?|cartes|résultats)\b/i.exec(o.compteur);
    const annonce = m ? Number(m[1].replace(/[.,]/g, '')) : null;
    const cartes = o.cartes.length;
    const lu = Number.isFinite(annonce) && annonce !== null;
    const pagine = o.pagination !== '';
    // le compteur affiché est le TOTAL des résultats : sur une page paginée, moins de cartes que le total est NORMAL (« pagine », jamais « incomplet »)
    const etat = !lu ? 'compteur-non-lu' : cartes === annonce ? 'complet' : pagine ? 'pagine' : cartes < annonce ? 'incomplet' : 'incoherent';
    return {
        cartes, annonce: lu ? annonce : null, compteur: o.compteur, pagination: o.pagination, pagine, etat,
        complet: etat === 'complet' ? true : etat === 'incomplet' ? false : null, zoneRepli: o.zoneRepli,
        sansNumero: o.cartes.filter(c => c.numero === '').length, sansImage: o.cartes.filter(c => c.img === '').length,
        htmlTronque: o.htmlTronque, octetsHtml: Buffer.byteLength(o.html), sha256Html: crypto.createHash('sha256').update(o.html).digest('hex')
    };
}

const slugDe = url => {
    const u = new URL(url);
    const brut = u.searchParams.get('expansion') || u.pathname.split('/').filter(Boolean).pop() || 'page';
    return brut.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page';
};

/** Écrit page + diagnostic, sans jamais écraser. Rend les deux noms. */
function ecrireReleve(dossier, o, diag, le = new Date()) {
    const base = `${slugDe(o.url)}--${horodatage(le)}`;
    for (let i = 0; i < 100; i++) {
        const suffixe = `${base}${i ? `-${i + 1}` : ''}.json`;
        const page = path.join(dossier, `page--${suffixe}`), dg = path.join(dossier, `diag--${suffixe}`);
        if (fs.existsSync(page) || fs.existsSync(dg)) continue;
        fs.writeFileSync(page, JSON.stringify({ ...o, le: le.toISOString(), diagnostic: diag }), { flag: 'wx' });
        fs.writeFileSync(dg, JSON.stringify({ schema: 1, url: o.url, le: le.toISOString(), ...diag }), { flag: 'wx' });
        return { page: path.basename(page), diag: path.basename(dg) };
    }
    throw new Error('plus de 100 relevés pour la même seconde');
}

function jugerReleve(brut) {
    let o;
    try { o = JSON.parse(brut); } catch { return { statut: 400, corps: { ok: false, motif: 'corps illisible : ce n\'est pas du JSON' } }; }
    const v = validerReleve(o);
    if (!v.ok) return { statut: v.statut, corps: { ok: false, motif: v.motif } };
    return { statut: 200, releve: o, diagnostic: diagnostiquer(o) };
}

async function demarrer({ port = PORT_DEFAUT, dossier = DOSSIER_DEFAUT, racine = RACINE_AUTORISEE, maxOctets = CORPS_MAX_OCTETS, journal = m => console.log(m) } = {}) {
    if (dansLeDepot(dossier)) throw new Error(`le dossier « ${dossier} » est dans le dépôt : les relevés n'y entrent jamais`);
    if (!dansRacineAutorisee(dossier, racine)) throw new Error(`le dossier « ${dossier} » n'est pas sous la racine autorisée « ${racine} » : le récepteur n'écrit que là`);   // GARDE:racine
    if (dansApportsManuels(dossier)) throw new Error(`le dossier « ${dossier} » est un dossier d'apports manuels (ou est dedans) : jamais écrit par un outil`);
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
        if (req.url !== '/releve') return refuser(404, 'seul le chemin /releve existe');   // GARDE:chemin
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
                const j = jugerReleve(Buffer.concat(morceaux).toString('utf8'));
                if (j.statut !== 200) return refuser(j.statut, j.corps.motif);
                const noms = ecrireReleve(dossier, j.releve, j.diagnostic);
                const d = j.diagnostic;
                journal(`✅ ${slugDe(j.releve.url)} : ${d.cartes} carte(s) relevée(s), compteur « ${d.compteur.slice(0, 60)} », ${{ complet: 'complet', incomplet: `INCOMPLET (${d.annonce} annoncées, aucune pagination)`, pagine: `paginé (compteur = total ${d.annonce})`, incoherent: `INCOHÉRENT (${d.annonce} annoncées)`, 'compteur-non-lu': 'compteur non lu' }[d.etat]}${d.zoneRepli ? ', zone de repli' : ''}, ${d.sansNumero} sans numéro, ${d.sansImage} sans image → ${noms.page}`);
                repondre(200, { ok: true, fichier: noms.page, diagnostic: d });
            } catch (e) { journal(`🔴 erreur interne : ${e.message}`); repondre(500, { ok: false, motif: 'erreur interne du récepteur' }); }
        });
    });
    serveur.requestTimeout = 30000;
    await new Promise((ok, ko) => { serveur.once('error', ko); serveur.listen(port, HOTE, ok); });
    const a = serveur.address();
    return { port: a.port, adresse: a.address, fermer: () => new Promise(ok => { serveur.close(() => ok()); serveur.closeAllConnections?.(); }) };
}

module.exports = { demarrer, validerReleve, diagnostiquer, jugerReleve, ecrireReleve, slugDe, dansLeDepot, dansApportsManuels, dansRacineAutorisee, HOTE, PORT_DEFAUT, ORIGINE_ATTENDUE, ENTETE_MARQUE, VALEUR_MARQUE, DOSSIER_DEFAUT, CORPS_MAX_OCTETS, HTML_MAX, CARTES_MAX };

if (require.main === module) {
    const args = process.argv.slice(2);
    const AUTORISES = [/^--port=(\d{4,5})$/, /^--dossier=.+$/];
    const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
    const port = Number(args.find(a => a.startsWith('--port='))?.slice(7) ?? PORT_DEFAUT);
    if (inconnus.length || !(port >= 1024 && port <= 65535)) {
        console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}permis : --port=<1024-65535> (défaut ${PORT_DEFAUT}, = PORT du userscript), --dossier=<chemin> (sous la racine du chantier, hors du dépôt). Le récepteur n'écoute que ${HOTE}.`);
        process.exit(2);
    }
    const dossier = args.find(a => a.startsWith('--dossier='))?.slice(10) ?? DOSSIER_DEFAUT;
    demarrer({ port, dossier }).then(s => {
        console.log(`Récepteur pokemon.com : http://${s.adresse}:${s.port}/releve — dossier ${dossier} — Ctrl+C pour arrêter. Aucune requête sortante.`);
    }).catch(e => { console.error('❌', e.message); process.exit(1); });
}
