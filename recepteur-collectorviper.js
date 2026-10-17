// ============================================================
// RÉCEPTEUR PASSIF DE COLLECTORVIPER — reçoit ce que la page ouverte PAR LE TESTEUR affiche (lot CVIPER, 2026-10-17)
// ============================================================
//   node recepteur-collectorviper.js [--port=8767] [--dossier=<chemin>]
//
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : « Collectorviper (japonais ancien) : méthode passive acceptée (pages ouvertes par moi, userscript au clic). Priorité BASSE. »
// Ce que MESURE-JP a lu de la source : LiveJournal User Agreement cl. 9.2.6 (pas de script automatique qui collecte) ; robots.txt Crawl-delay 100 s. Donc ce programme ne fait
// AUCUNE requête réseau : il écoute 127.0.0.1 (l'hôte n'est pas réglable), reçoit ce que userscript-collectorviper.js envoie au clic, et écrit des fichiers locaux. Aucune base,
// aucun R2, aucun importeur : l'appariement se calibrera sur la première vraie capture du testeur.
//
// PROTOCOLE (POST /releve, JSON), DEUX types de message, un PAQUET par page ouverte :
//   · type « image »  : { schema, type, paquet, url, indice, mime: 'image/png', donnees: <base64> } → <dossier>/<slug>--<paquet>/img-NNNN.png (jamais écrasé) ;
//   · type « page »   : { schema, type, paquet, url, titre, images: [{ indice, src, w, h, alt, title, legende, intertitre, etat, raison }] } → <slug>--<paquet>/page.json (clôture).
//     etat ∈ lue (octets reçus) · illisible (raison écrite) · sous-seuil (largeur < LARGEUR_MIN de collecte-cartes/seuils-images.js, sans octets).
//   Le COMPTE est refait ici, sur les fichiers réellement reçus : vues / lues / illisibles / sous le seuil / manquantes (déclarées lues, fichier absent → jamais comptées lues).
//
// LES GARDES S'ÉCRIVENT PAR CE QU'ELLES AUTORISENT :
//   · méthode POST, chemin exactement /releve ; Host exactement 127.0.0.1:<port> ou localhost:<port> ;
//   · en-tête fixe X-Rat-Market et Content-Type application/json (OPTIONS reste 405, sans CORS) ;
//   · Origin : seulement https://collectorviper.livejournal.com (SUPPOSITION du @match, à confirmer par le testeur), ABSENTE, ou celle d'une extension ;
//   · adresse de page : https, hôte exactement collectorviper.livejournal.com, ni port ni identifiants ni ancre ;
//   · corps ≤ CORPS_MAX_OCTETS (déclaration ET flux) ; image = base64 strict, signature PNG, ≤ IMAGE_OCTETS_MAX ;
//   · une image « lue » n'est admise que si sa largeur ≥ LARGEUR_MIN, une image « sous-seuil » que si elle est < LARGEUR_MIN ;
//   · écriture : seulement sous la racine du chantier, jamais dans le dépôt, jamais dans un dossier d'apports manuels.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const PK = require('./recepteur-pikaqian');
const { LARGEUR_MIN } = require('./collecte-cartes/seuils-images');

const HOTE = '127.0.0.1';
const PORT_DEFAUT = 8767;            // = PORT du userscript : les deux changent ensemble (PikaQian 8765, pokemon.com 8766)
const ORIGINE_ATTENDUE = 'https://collectorviper.livejournal.com';   // SUPPOSITION : aucune requête n'a vérifié cette adresse
const HOTE_PAGES = 'collectorviper.livejournal.com';
const ORIGINE_EXTENSION = /^(chrome|moz)-extension:\/\/[A-Za-z0-9-]+$/;
const { ENTETE_MARQUE, VALEUR_MARQUE } = PK;
const DOSSIER_DEFAUT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\collectorviper-passif';
const IMAGE_OCTETS_MAX = 6 * 1024 * 1024;
const CORPS_MAX_OCTETS = 12 * 1024 * 1024;     // > 6 Mo en base64 (8 Mo) + enveloppe
const IMAGES_MAX = 300;
const { dansLeDepot, dansApportsManuels, dansRacineAutorisee, RACINE_AUTORISEE } = PK;

const CLES_IMAGE = 'donnees,indice,mime,paquet,schema,type,url';
const CLES_PAGE = 'images,paquet,schema,titre,type,url';
const CLES_ENTREE = 'alt,etat,h,indice,intertitre,legende,raison,src,title,w';
const ETATS = ['lue', 'illisible', 'sous-seuil'];
const RE_PAQUET = /^\d{8}T\d{6}Z-[a-f0-9]{8}$/;
const estChaine = (v, max) => typeof v === 'string' && v.length <= max;
const entierPositif = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const SIGNATURE_PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const nonOk = (statut, motif) => ({ ok: false, statut, motif });

function adresseValide(url) {
    if (!estChaine(url, 2000)) return false;
    try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === HOTE_PAGES && !u.port && !u.username && !u.password && !u.hash; } catch { return false; }
}
const slugDe = url => {
    const u = new URL(url);
    const brut = u.pathname.split('/').filter(Boolean).pop() || 'page';
    return brut.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page';
};
const sousDossier = (dossier, url, paquet) => path.join(dossier, `${slugDe(url)}--${paquet}`);
const nomImage = indice => `img-${String(indice).padStart(4, '0')}.png`;

/** Valide ce qui est commun (schéma, paquet, adresse). */
function validerCommun(o) {
    if (o.schema !== 1) return nonOk(400, 'schema doit valoir 1');   // GARDE:schema
    if (typeof o.paquet !== 'string' || !RE_PAQUET.test(o.paquet)) return nonOk(400, 'paquet : AAAAMMJJTHHMMSSZ-<8 hexadécimaux> exigé');   // GARDE:paquet
    if (!adresseValide(o.url)) return nonOk(422, `adresse « ${String(o.url).slice(0, 120)} » : ce n'est pas une page de ${ORIGINE_ATTENDUE}`);   // GARDE:url
    return null;
}

function validerImage(o) {
    const c = validerCommun(o); if (c) return c;
    if (!Number.isInteger(o.indice) || o.indice < 1 || o.indice > IMAGES_MAX) return nonOk(400, `indice : un entier de 1 à ${IMAGES_MAX}`);   // GARDE:indice
    if (o.mime !== 'image/png') return nonOk(400, 'mime : seul image/png est accepté');   // GARDE:mime
    if (typeof o.donnees !== 'string' || o.donnees.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(o.donnees)) return nonOk(400, 'donnees : du base64 strict exigé');   // GARDE:base64
    if (Math.floor(o.donnees.length / 4) * 3 > IMAGE_OCTETS_MAX + 3) return nonOk(413, `image de plus de ${IMAGE_OCTETS_MAX} octets`);   // GARDE:taille-image
    const octets = Buffer.from(o.donnees, 'base64');
    if (octets.length > IMAGE_OCTETS_MAX) return nonOk(413, `image de ${octets.length} octets : au-delà de ${IMAGE_OCTETS_MAX} octets`);
    if (octets.length < SIGNATURE_PNG.length || !octets.subarray(0, 8).equals(SIGNATURE_PNG)) return nonOk(415, 'les octets reçus ne portent pas la signature PNG');   // GARDE:png
    return { ok: true, octets };
}

function validerPage(o) {
    const c = validerCommun(o); if (c) return c;
    if (!estChaine(o.titre, 300)) return nonOk(400, 'titre : une chaîne de 300 caractères au plus');   // GARDE:titre
    if (!Array.isArray(o.images) || o.images.length > IMAGES_MAX) return nonOk(400, `images : un tableau de ${IMAGES_MAX} entrées au plus`);   // GARDE:images
    const vus = new Set();
    for (let i = 0; i < o.images.length; i++) {
        const e = o.images[i];
        if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).sort().join(',') !== CLES_ENTREE) return nonOk(400, `image ${i} : clés exactes ${CLES_ENTREE} exigées`);   // GARDE:entree
        if (!Number.isInteger(e.indice) || e.indice < 1 || e.indice > IMAGES_MAX || vus.has(e.indice)) return nonOk(400, `image ${i} : indice entier de 1 à ${IMAGES_MAX}, unique`);
        vus.add(e.indice);
        if (!estChaine(e.legende, 500)) return nonOk(400, `image ${i} : légende de 500 caractères au plus`);
        if (![e.alt, e.title, e.intertitre].every(x => estChaine(x, 300))) return nonOk(400, `image ${i} : alt, title et intertitre en chaînes de 300 caractères au plus`);
        if (!entierPositif(e.w, 100000) || !entierPositif(e.h, 100000)) return nonOk(400, `image ${i} : dimensions en entiers de 0 à 100000`);
        if (!ETATS.includes(e.etat)) return nonOk(400, `image ${i} : état « ${String(e.etat).slice(0, 30)} » : seuls ${ETATS.join(', ')} sont admis`);   // GARDE:etat
        if (!estChaine(e.raison, 200) || (e.etat === 'lue') !== (e.raison === '')) return nonOk(400, `image ${i} : raison vide pour « lue », écrite pour les autres états`);   // GARDE:raison
        if (e.etat === 'lue' && e.w < LARGEUR_MIN) return nonOk(422, `image ${i} : « lue » à ${e.w} px, sous le seuil de ${LARGEUR_MIN} px`);   // GARDE:seuil
        if (e.etat === 'sous-seuil' && e.w >= LARGEUR_MIN) return nonOk(422, `image ${i} : « sous-seuil » à ${e.w} px, au-dessus du seuil de ${LARGEUR_MIN} px`);
        if (!(e.src === '' || (estChaine(e.src, 2000) && /^https:\/\/\S+$/.test(e.src)))) return nonOk(400, `image ${i} : src vide ou en https`);   // GARDE:src
    }
    return { ok: true };
}

/** Juge un message brut. Rend { statut, corps } ou { statut: 200, type, message, ... }. */
function jugerMessage(brut) {
    let o;
    try { o = JSON.parse(brut); } catch { return { statut: 400, corps: { ok: false, motif: 'corps illisible : ce n\'est pas du JSON' } }; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { statut: 400, corps: { ok: false, motif: 'le corps doit être un objet JSON' } };   // GARDE:objet
    if (o.type !== 'image' && o.type !== 'page') return { statut: 400, corps: { ok: false, motif: 'type : « image » ou « page »' } };   // GARDE:type
    const attendues = o.type === 'image' ? CLES_IMAGE : CLES_PAGE;
    const cles = Object.keys(o).sort().join(',');
    if (cles !== attendues) return { statut: 400, corps: { ok: false, motif: `clés reçues « ${cles.slice(0, 200)} » : seules ${attendues} sont acceptées` } };   // GARDE:cles
    const v = o.type === 'image' ? validerImage(o) : validerPage(o);
    if (!v.ok) return { statut: v.statut, corps: { ok: false, motif: v.motif } };
    return { statut: 200, type: o.type, message: o, octets: v.octets };
}

function ecrireImage(dossier, o, octets) {
    const sub = sousDossier(dossier, o.url, o.paquet);
    if (fs.existsSync(path.join(sub, 'page.json'))) return { statut: 409, motif: 'ce paquet est déjà clos (page.json existe)' };
    fs.mkdirSync(sub, { recursive: true });
    const fichier = nomImage(o.indice);
    try { fs.writeFileSync(path.join(sub, fichier), octets, { flag: 'wx' }); } catch (e) { if (e.code === 'EEXIST') return { statut: 409, motif: `${fichier} existe déjà dans ce paquet` }; throw e; }
    return { statut: 200, sub: path.basename(sub), fichier };
}

function ecrirePage(dossier, o, le = new Date()) {
    const sub = sousDossier(dossier, o.url, o.paquet);
    fs.mkdirSync(sub, { recursive: true });
    const comptes = { vues: o.images.length, lues: 0, illisibles: 0, sousSeuil: 0, manquantes: 0 };
    const images = o.images.map(e => {
        const sortie = { ...e };
        if (e.etat === 'lue') {
            const f = path.join(sub, nomImage(e.indice));
            if (fs.existsSync(f)) {
                const b = fs.readFileSync(f);
                sortie.fichier = nomImage(e.indice); sortie.sha256 = crypto.createHash('sha256').update(b).digest('hex'); sortie.octets = b.length;
                comptes.lues++;
            } else { sortie.manquante = true; comptes.manquantes++; }
        } else if (e.etat === 'illisible') comptes.illisibles++;
        else comptes.sousSeuil++;
        return sortie;
    });
    const etat = comptes.manquantes ? 'incomplet' : 'complet';
    try { fs.writeFileSync(path.join(sub, 'page.json'), JSON.stringify({ schema: 1, url: o.url, titre: o.titre, paquet: o.paquet, le: le.toISOString(), seuil: LARGEUR_MIN, comptes, etat, images }), { flag: 'wx' }); }
    catch (e) { if (e.code === 'EEXIST') return { statut: 409, motif: 'ce paquet est déjà clos (page.json existe)' }; throw e; }
    return { statut: 200, sub: path.basename(sub), comptes, etat };
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
                const j = jugerMessage(Buffer.concat(morceaux).toString('utf8'));
                if (j.statut !== 200) return refuser(j.statut, j.corps.motif);
                if (j.type === 'image') {
                    const w = ecrireImage(dossier, j.message, j.octets);
                    if (w.statut !== 200) return refuser(w.statut, w.motif);
                    return repondre(200, { ok: true, fichier: w.fichier });
                }
                const w = ecrirePage(dossier, j.message);
                if (w.statut !== 200) return refuser(w.statut, w.motif);
                const c = w.comptes;
                journal(`✅ ${slugDe(j.message.url)} : ${c.vues} image(s), ${c.lues} lue(s), ${c.illisibles} illisible(s), ${c.sousSeuil} sous le seuil, ${c.manquantes} manquante(s) — ${w.etat.toUpperCase()} → ${w.sub}`);
                repondre(200, { ok: true, dossier: w.sub, comptes: c, etat: w.etat });
            } catch (e) { journal(`🔴 erreur interne : ${e.message}`); repondre(500, { ok: false, motif: 'erreur interne du récepteur' }); }
        });
    });
    serveur.requestTimeout = 60000;
    await new Promise((ok, ko) => { serveur.once('error', ko); serveur.listen(port, HOTE, ok); });
    const a = serveur.address();
    return { port: a.port, adresse: a.address, fermer: () => new Promise(ok => { serveur.close(() => ok()); serveur.closeAllConnections?.(); }) };
}

module.exports = { demarrer, jugerMessage, validerImage, validerPage, ecrirePage, ecrireImage, slugDe, dansLeDepot, dansApportsManuels, dansRacineAutorisee, HOTE, PORT_DEFAUT, ORIGINE_ATTENDUE, HOTE_PAGES, ENTETE_MARQUE, VALEUR_MARQUE, DOSSIER_DEFAUT, CORPS_MAX_OCTETS, IMAGE_OCTETS_MAX, IMAGES_MAX, LARGEUR_MIN };

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
        console.log(`Récepteur Collectorviper : http://${s.adresse}:${s.port}/releve — dossier ${dossier} — Ctrl+C pour arrêter. Aucune requête sortante.`);
    }).catch(e => { console.error('❌', e.message); process.exit(1); });
}
