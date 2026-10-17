// ============================================================
// RÉCEPTEUR PASSIF DES FICHES CARDMARKET — reçoit ce que la fiche ouverte PAR LE TESTEUR affiche (lot CM-PASSIF, 2026-10-17)
// ============================================================
//   node recepteur-cardmarket-fiche.js [--port=8768] [--dossier=<chemin>]
//
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : relevé PASSIF des fiches des 64 paires Black Star (userscript au clic sur les pages qu'il ouvre lui-même). Règle permanente : AUCUNE requête
// de notre part vers Cardmarket. Ce programme n'en fait aucune : il écoute 127.0.0.1 (l'hôte n'est pas réglable), reçoit ce que userscript-cardmarket-fiche.js envoie au clic,
// et écrit des fichiers locaux. Aucune base, aucun R2.
//
// PROTOCOLE (POST /releve, JSON, UN message par clic) : clés exactes
//   schema, paquet, url, titre, nom, idProduct, imageSrc, w, h, mime, pixels, pixelsMotif, verdictTesteur
//   · pixels : base64 d'un PNG ou d'un JPEG (en-tête vérifié contre mime), ou null avec pixelsMotif ∈ canvas-protege · image-non-chargee · aucune-image · trop-volumineuse ;
//   · verdictTesteur ∈ tampon-visible · pas-de-tampon · ne-sais-pas (le témoin humain : ce que le testeur voit sur l'image).
// ÉCRIT sous le dossier : <slug>--<paquet>.json + <slug>--<paquet>.png|jpg (image décodée), JAMAIS écrasés (flag wx, 409 sinon).
// RÉPONSE : la paire reconnue (n°, set, numéro, version V1/V2, tampon attendu) ou « hors des 64 », et combien des 128 adresses sont déjà relevées (adresses DISTINCTES de la liste).
//
// LES GARDES S'ÉCRIVENT PAR CE QU'ELLES AUTORISENT : POST sur /releve exactement ; Host exactement 127.0.0.1:<port> ou localhost:<port> ; en-tête fixe X-Rat-Market ; Content-Type JSON ;
// Origin : https://www.cardmarket.com, ABSENTE, ou d'extension (hypothèse héritée des autres récepteurs, non vérifiée ici) ; corps ≤ 4 Mo (déclaré ET flux) ; adresse = fiche
// produit https://www.cardmarket.com/<langue>/Pokemon/Products/Singles/<set>/<slug>, sans port, identifiants, requête ni ancre ; écriture seulement sous la racine du chantier,
// jamais dans le dépôt, jamais dans un dossier d'apports manuels.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const PK = require('./recepteur-pikaqian');
const CM = require('./collecte-cartes/cm-passif');
const LISTE = require('./collecte-cartes/cm-passif-liste.json');

const HOTE = '127.0.0.1';
const PORT_DEFAUT = 8768;            // = PORT du userscript : les deux changent ensemble (PikaQian 8765, pokemon.com 8766, Collectorviper 8767)
const ORIGINE_ATTENDUE = 'https://www.cardmarket.com';
const ORIGINE_EXTENSION = /^(chrome|moz)-extension:\/\/[A-Za-z0-9-]+$/;
const { ENTETE_MARQUE, VALEUR_MARQUE, dansLeDepot, dansApportsManuels, dansRacineAutorisee, RACINE_AUTORISEE } = PK;
const DOSSIER_DEFAUT = path.join(RACINE_AUTORISEE, 'cardmarket-passif');
const CORPS_MAX_OCTETS = 4 * 1024 * 1024;
const IMAGE_OCTETS_MAX = 2.5 * 1024 * 1024;     // 2,5 Mo en base64 ≈ 3,34 Mo : l'enveloppe tient sous les 4 Mo
const MAX_RELEVES_DEFAUT = 2000;

const PIXELS_MAX = 12000000;                    // limite de pixels du décodage (sharp) : une image plus grande n'est jamais décodée
const IMAGE_INTROUVABLE = 'image-du-produit-introuvable';
const CLES = 'h,idProduct,imageMotif,imageSrc,mime,nom,paquet,pixels,pixelsMotif,schema,titre,url,verdictTesteur,w';
const VERDICTS = ['tampon-visible', 'pas-de-tampon', 'ne-sais-pas'];
const MOTIFS = ['canvas-protege', 'image-non-chargee', 'aucune-image', 'trop-volumineuse'];
const SIGNATURES = { 'image/png': Buffer.from('89504e470d0a1a0a', 'hex'), 'image/jpeg': Buffer.from('ffd8ff', 'hex') };
const EXTENSION = { 'image/png': 'png', 'image/jpeg': 'jpg' };
const RE_PAQUET = /^\d{8}T\d{6}Z-[a-f0-9]{8}$/;
const INDEX = CM.indexer(LISTE);
const SUR = Object.keys(INDEX).length;
const estChaine = (v, max) => typeof v === 'string' && v.length <= max;
const nonOk = (statut, motif) => ({ ok: false, statut, motif });

/** La paire reconnue pour une adresse de fiche : { n, v, tampon, set, numero, nom } ou null (hors des 64). La langue n'entre pas. */
function reconnaitre(url) {
    const cle = CM.cleDeAdresse(url);
    return cle && Object.prototype.hasOwnProperty.call(INDEX, cle) ? INDEX[cle] : null;
}

function adresseValide(url) {
    if (!estChaine(url, 2000)) return false;
    try { const u = new URL(url); return u.protocol === 'https:' && !u.port && !u.username && !u.password && !u.hash && !u.search && CM.cleDeAdresse(url) !== null; } catch { return false; }
}
const slugDe = url => {
    const brut = new URL(url).pathname.split('/').filter(Boolean).pop() || 'fiche';
    return brut.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'fiche';
};
const nomBase = (url, paquet) => `${slugDe(url)}--${paquet}`;

function validerMessage(o) {
    if (o.schema !== 1) return nonOk(400, 'schema doit valoir 1');   // GARDE:schema
    if (typeof o.paquet !== 'string' || !RE_PAQUET.test(o.paquet)) return nonOk(400, 'paquet : AAAAMMJJTHHMMSSZ-<8 hexadécimaux> exigé');   // GARDE:paquet
    if (!adresseValide(o.url)) return nonOk(422, `adresse « ${String(o.url).slice(0, 120)} » : ce n'est pas une fiche produit de ${ORIGINE_ATTENDUE}/<langue>/Pokemon/Products/Singles/<set>/<produit>`);   // GARDE:url
    if (!estChaine(o.titre, 300) || !estChaine(o.nom, 300)) return nonOk(400, 'titre et nom : des chaînes de 300 caractères au plus');   // GARDE:titre
    if (!(o.idProduct === null || (Number.isInteger(o.idProduct) && o.idProduct >= 1 && o.idProduct <= 99999999))) return nonOk(400, 'idProduct : null ou un entier positif');   // GARDE:idproduct
    if (!(o.imageSrc === '' || (estChaine(o.imageSrc, 2000) && /^https:\/\/\S+$/.test(o.imageSrc)))) return nonOk(400, 'imageSrc : vide ou en https');   // GARDE:src
    if (![o.w, o.h].every(x => Number.isInteger(x) && x >= 0 && x <= 100000)) return nonOk(400, 'w et h : des entiers de 0 à 100000');   // GARDE:dimensions
    if (!VERDICTS.includes(o.verdictTesteur)) return nonOk(400, `verdictTesteur : seuls ${VERDICTS.join(', ')} sont admis`);   // GARDE:verdict
    if (!(o.imageMotif === null || o.imageMotif === IMAGE_INTROUVABLE)) return nonOk(400, `imageMotif : null ou « ${IMAGE_INTROUVABLE} »`);   // GARDE:imagemotif
    if (o.imageMotif !== null && (o.pixels !== null || o.imageSrc !== '' || o.pixelsMotif !== 'aucune-image')) return nonOk(400, `imageMotif « ${IMAGE_INTROUVABLE} » : sans pixels, sans adresse d'image, pixelsMotif « aucune-image »`);
    if (o.pixels === null) {
        if (o.mime !== null) return nonOk(400, 'mime doit valoir null quand pixels vaut null');
        if (!MOTIFS.includes(o.pixelsMotif)) return nonOk(400, `pixelsMotif : sans pixels, l'un de ${MOTIFS.join(', ')} est exigé`);   // GARDE:motif
        return { ok: true, octets: null };
    }
    if (o.pixelsMotif !== null) return nonOk(400, 'pixelsMotif doit valoir null quand des pixels sont envoyés');
    if (!Object.prototype.hasOwnProperty.call(SIGNATURES, o.mime)) return nonOk(400, 'mime : image/png ou image/jpeg');   // GARDE:mime
    if (typeof o.pixels !== 'string' || o.pixels.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(o.pixels)) return nonOk(400, 'pixels : du base64 strict exigé');   // GARDE:base64
    if (Math.floor(o.pixels.length / 4) * 3 > IMAGE_OCTETS_MAX + 3) return nonOk(413, `image de plus de ${IMAGE_OCTETS_MAX} octets`);   // GARDE:taille-image
    const octets = Buffer.from(o.pixels, 'base64');
    if (octets.length > IMAGE_OCTETS_MAX) return nonOk(413, `image de ${octets.length} octets : au-delà de ${IMAGE_OCTETS_MAX} octets`);
    const sig = SIGNATURES[o.mime];
    if (octets.length < sig.length + 1 || !octets.subarray(0, sig.length).equals(sig)) return nonOk(415, `les octets reçus ne portent pas l'en-tête ${o.mime}`);   // GARDE:signature
    return { ok: true, octets };
}

/** Juge un message brut. Rend { statut: 200, message, octets } ou { statut, corps }. */
function jugerMessage(brut) {
    let o;
    try { o = JSON.parse(brut); } catch { return { statut: 400, corps: { ok: false, motif: 'corps illisible : ce n\'est pas du JSON' } }; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { statut: 400, corps: { ok: false, motif: 'le corps doit être un objet JSON' } };   // GARDE:objet
    const cles = Object.keys(o).sort().join(',');
    if (cles !== CLES) return { statut: 400, corps: { ok: false, motif: `clés reçues « ${cles.slice(0, 200)} » : seules ${CLES} sont acceptées` } };   // GARDE:cles
    const v = validerMessage(o);
    if (!v.ok) return { statut: v.statut, corps: { ok: false, motif: v.motif } };
    return { statut: 200, message: o, octets: v.octets };
}

/** DÉCODAGE BORNÉ : les octets s'ouvrent vraiment (sharp, limite de pixels), au format déclaré, aux dimensions déclarées. Rend null si tout va bien, sinon { statut, motif }. */
async function verifierImage(o, octets) {
    const sharp = require('sharp');
    const formatAttendu = o.mime === 'image/png' ? 'png' : 'jpeg';
    let meta;
    try { meta = await sharp(octets, { limitInputPixels: false, failOn: 'error' }).metadata(); } catch (e) { return { statut: 415, motif: `image non décodable : ${String(e.message).slice(0, 100)}` }; }   // GARDE:decodage
    if (meta.format !== formatAttendu) return { statut: 415, motif: `image non décodable : format lu « ${meta.format} », ${formatAttendu} déclaré` };
    if (!meta.width || !meta.height || meta.width * meta.height > PIXELS_MAX) return { statut: 413, motif: `image de ${meta.width} × ${meta.height} : au-delà de la limite de ${PIXELS_MAX} pixels` };   // GARDE:pixels
    if (meta.width !== o.w || meta.height !== o.h) return { statut: 422, motif: `dimensions : l'image fait ${meta.width} × ${meta.height}, le relevé en déclare ${o.w} × ${o.h}` };   // GARDE:dimensions-image
    try { await sharp(octets, { limitInputPixels: PIXELS_MAX, failOn: 'error' }).raw().toBuffer(); } catch (e) { return { statut: 415, motif: `image non décodable : ${String(e.message).slice(0, 100)}` }; }
    return null;
}

/** L'idProduct lu dans l'adresse d'une image Cardmarket (…/<id>/<id>.jpg), ou null. */
const idDeImage = src => { const m = /\/(\d+)\/\1\.[A-Za-z]+$/.exec(String(src)); return m ? Number(m[1]) : null; };
/** Adresse de la liste : l'image doit porter l'idProduct de CETTE adresse (V1 ou V2). Hors liste, sans image ou « image introuvable » : rien à recouper → false. */
const imageDiscordante = (paire, o) => !!paire && o.imageSrc !== '' && idDeImage(o.imageSrc) !== paire.idProduct;

const jsonsDe =dossier => fs.readdirSync(dossier).filter(f => f.endsWith('.json'));
/** Combien des adresses de la liste ont au moins un relevé sur disque (adresses DISTINCTES ; un fichier illisible est ignoré). */
function compterRelevees(dossier) {
    const vues = new Set();
    for (const f of jsonsDe(dossier)) {
        try { const j = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8')); if (typeof j.cle === 'string' && Object.prototype.hasOwnProperty.call(INDEX, j.cle)) vues.add(j.cle); } catch { /* ignoré */ }
    }
    return vues.size;
}

function ecrireReleve(dossier, o, octets, le = new Date(), maxReleves = MAX_RELEVES_DEFAUT) {
    const base = nomBase(o.url, o.paquet);
    const fJson = path.join(dossier, `${base}.json`);
    const fImage = octets ? path.join(dossier, `${base}.${EXTENSION[o.mime]}`) : null;
    if (fs.existsSync(fJson) || (fImage && fs.existsSync(fImage))) return { statut: 409, motif: 'ce relevé existe déjà (jamais écrasé)' };
    if (jsonsDe(dossier).length >= maxReleves) return { statut: 507, motif: `plafond de ${maxReleves} relevés sur disque atteint : archive ou supprime des relevés, puis recommence` };   // GARDE:plafond
    const paire = reconnaitre(o.url);
    const cle = CM.cleDeAdresse(o.url);
    const { pixels, ...reste } = o;
    const fiche = { ...reste, le: le.toISOString(), cle: paire ? cle : null, paire: paire ? { n: paire.n, set: paire.set, numero: paire.numero, version: paire.v, tamponAttendu: paire.tampon } : null, horsDesSoixanteQuatre: !paire, imageDiscordante: imageDiscordante(paire, o), sansImageRattachee: o.imageMotif === IMAGE_INTROUVABLE };
    if (octets) { fiche.fichierImage = path.basename(fImage); fiche.sha256 = crypto.createHash('sha256').update(octets).digest('hex'); fiche.octets = octets.length; }
    try {
        if (octets) fs.writeFileSync(fImage, octets, { flag: 'wx' });
        fs.writeFileSync(fJson, JSON.stringify(fiche), { flag: 'wx' });
    } catch (e) { if (e.code === 'EEXIST') return { statut: 409, motif: 'ce relevé existe déjà (jamais écrasé)' }; throw e; }
    return { statut: 200, base, paire, relevees: compterRelevees(dossier), imageDiscordante: fiche.imageDiscordante, sansImageRattachee: fiche.sansImageRattachee };
}

async function demarrer({ port = PORT_DEFAUT, dossier = DOSSIER_DEFAUT, racine = RACINE_AUTORISEE, maxOctets = CORPS_MAX_OCTETS, maxReleves = MAX_RELEVES_DEFAUT, journal = m => console.log(m) } = {}) {
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
        const morceaux = []; let total = 0, trop = false, minuteur = null, repondu413 = false;
        const refuser413 = () => { if (repondu413) return; repondu413 = true; clearTimeout(minuteur); refuser(413, `corps de plus de ${maxOctets} octets`); };
        req.on('data', c => {
            total += c.length;
            if (trop) { if (total > 2 * maxOctets) refuser413(); return; }   // déjà trop gros : le flux est JETÉ, jamais stocké
            if (total > maxOctets) {   // GARDE:taille-flux
                // On cesse de STOCKER (jamais plus que la borne en mémoire) mais on lit (et jette) la suite du flux avant de répondre : une connexion fermée avec des octets
                // non lus fait un RST qui EFFACE la réponse chez le client (banc instable, 2 passages sur 3). La réponse 413 (Connection: close) part à la fin du flux, à 2 × la borne,
                // ou après 2 s — au plus ; la connexion se ferme ensuite, une fois la réponse envoyée.
                trop = true; morceaux.length = 0;
                minuteur = setTimeout(refuser413, 2000);
                minuteur.unref();
            }
            else morceaux.push(c);
        });
        req.on('error', () => { /* coupure : rien à écrire */ });
        req.on('end', async () => {
            if (trop) return refuser413();
            try {
                const j = jugerMessage(Buffer.concat(morceaux).toString('utf8'));
                if (j.statut !== 200) return refuser(j.statut, j.corps.motif);
                if (j.octets) { const d = await verifierImage(j.message, j.octets); if (d) return refuser(d.statut, d.motif); }
                const w = ecrireReleve(dossier, j.message, j.octets, new Date(), maxReleves);
                if (w.statut !== 200) return refuser(w.statut, w.motif);
                const p = w.paire;
                journal(`✅ ${slugDe(j.message.url)} : ${p ? `paire n°${p.n} ${p.set} ${p.numero}, ${p.v}, tampon attendu ${p.tampon}` : 'HORS DES 64'}${w.imageDiscordante ? ' — ⚠️ IMAGE DISCORDANTE (autre produit)' : ''}${w.sansImageRattachee ? ' — SANS IMAGE RATTACHÉE' : ''} — verdict ${j.message.verdictTesteur} — ${j.octets ? 'image écrite' : `sans image (${j.message.pixelsMotif})`} — ${w.relevees}/${SUR} adresses relevées`);
                repondre(200, { ok: true, paire: p ? { n: p.n, set: p.set, numero: p.numero, version: p.v, tamponAttendu: p.tampon } : null, horsDesSoixanteQuatre: !p, imageDiscordante: w.imageDiscordante, sansImageRattachee: w.sansImageRattachee, relevees: w.relevees, sur: SUR, fichier: w.base });
            } catch (e) { journal(`🔴 erreur interne : ${e.message}`); repondre(500, { ok: false, motif: 'erreur interne du récepteur' }); }
        });
    });
    serveur.requestTimeout = 60000;
    await new Promise((ok, ko) => { serveur.once('error', ko); serveur.listen(port, HOTE, ok); });
    const a = serveur.address();
    return { port: a.port, adresse: a.address, fermer: () => new Promise(ok => { serveur.close(() => ok()); serveur.closeAllConnections?.(); }) };
}

module.exports = { PIXELS_MAX, verifierImage, imageDiscordante, idDeImage, demarrer, jugerMessage, reconnaitre, ecrireReleve, compterRelevees, slugDe, HOTE, PORT_DEFAUT, ORIGINE_ATTENDUE, ENTETE_MARQUE, VALEUR_MARQUE, DOSSIER_DEFAUT, RACINE_AUTORISEE, CORPS_MAX_OCTETS, IMAGE_OCTETS_MAX, MAX_RELEVES_DEFAUT, SUR };

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
        console.log(`Récepteur fiches Cardmarket : http://${s.adresse}:${s.port}/releve — dossier ${dossier} — ${compterRelevees(dossier)}/${SUR} adresses déjà relevées — Ctrl+C pour arrêter. Aucune requête sortante.`);
    }).catch(e => { console.error('❌', e.message); process.exit(1); });
}
