'use strict';
// B9.1 — corps multipart du scanner du site : petit, strict, borné, sans dépendance.
// Accepte exactement deux parties, `source` (liste fermée) et `image` (une seule), et rien d'autre.
// Bornes : l'IMAGE fait au plus octetsMax (12 Mo pile passe) ; le CORPS entier au plus octetsMax + MARGE_ENTETES_OCTETS
// (en-têtes de parties et délimiteurs). La lecture entière a une échéance (DELAI_LECTURE_MS) : un client lent est coupé.
// Le nom de fichier annoncé par le client n'est jamais conservé. HEIC : jugé sur ses OCTETS seulement (marques du brief) ;
// savoir le DÉCODER n'est pas l'affaire de ce module (B9.2).
// Erreurs : lève { code, detail, statut[, fermer] } — IMAGE (413/415/422) ou ENTREE (400 ; 408 pour l'échéance, avec fermer:true :
// le handler répond avec Connection: close puis détruit la requête sur res.on('finish')). Elle ne lève jamais autre chose.
const { lireConfig } = require('../config');

const SOURCES = Object.freeze(['camera', 'fichier', 'collage']);
const CRLF = Buffer.from('\r\n'), CRLF2 = Buffer.from('\r\n\r\n');
const PARTIES_MAX = 8;
const MARGE_ENTETES_OCTETS = 64 * 1024;
const DELAI_LECTURE_MS = 30000;

class ErreurMultipart extends Error {
    constructor(code, detail, statut) { super(`${code}:${detail}`); this.code = code; this.detail = detail; this.statut = statut; }
}
const image = (detail, statut) => new ErreurMultipart('IMAGE', detail, statut);
const entree = detail => new ErreurMultipart('ENTREE', detail, 400);

// Le format se juge sur les octets, jamais sur le Content-Type ni sur l'extension annoncés.
function typeDesOctets(b) {
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && ['heic', 'heix', 'mif1'].includes(b.toString('latin1', 8, 12))) return 'image/heic';
    return null;
}

function boundaryDe(contentType) {
    if (typeof contentType !== 'string') throw entree('boundary');
    const morceaux = contentType.split(';').map(s => s.trim());
    if (morceaux[0].toLowerCase() !== 'multipart/form-data') throw entree('boundary');
    const bs = morceaux.slice(1).filter(p => /^boundary\s*=/i.test(p));
    if (bs.length !== 1) throw entree('boundary');                       // absente ou en double
    let v = bs[0].replace(/^boundary\s*=\s*/i, '');
    if (/^".*"$/.test(v)) v = v.slice(1, -1);
    if (!/^[0-9A-Za-z'()+_,\-./:=?]{1,70}$/.test(v)) throw entree('boundary');
    return v;
}

function lireCorps(req, octetsMax, delaiMs, minuterie) {
    const plafondCorps = octetsMax + MARGE_ENTETES_OCTETS;
    const cl = req.headers['content-length'];
    let annonce = null;
    if (cl !== undefined) {
        if (!/^\d+$/.test(String(cl))) throw entree('content-length');
        annonce = Number(cl);
        if (annonce > plafondCorps) throw image('trop-lourde', 413);       // refus AVANT toute lecture
    }
    return new Promise((resolve, reject) => {
        const morceaux = []; let total = 0, fini = false, minute = null;
        const nettoyer = () => { minuterie.clear(minute); req.removeListener('data', surDonnee); req.removeListener('end', surFin); req.removeListener('error', surErreur); req.removeListener('aborted', surErreur); req.removeListener('close', surClose); };
        const clore = (f, v) => { if (fini) return; fini = true; nettoyer(); f(v); };
        const surDonnee = c => {
            total += c.length;
            if (total > plafondCorps) { req.pause(); clore(reject, image('trop-lourde', 413)); return; }   // la lecture s'arrête ici
            if (annonce !== null && total > annonce) { req.pause(); clore(reject, entree('content-length')); return; }
            morceaux.push(c);
        };
        const surFin = () => { if (annonce !== null && total !== annonce) clore(reject, entree('content-length')); else clore(resolve, Buffer.concat(morceaux, total)); };
        const surErreur = () => clore(reject, entree('corps-interrompu'));
        const surClose = () => { if (!req.readableEnded) surErreur(); };
        minute = minuterie.set(() => {
            if (fini) return;
            // Le module ne détruit RIEN : détruire la socket avant la réponse ferait un reset au lieu d'un 408.
            // Le handler répond (statut, Connection: close) puis détruit la requête sur res.on('finish').
            const e = new ErreurMultipart('ENTREE', 'delai', 408); e.fermer = true;
            clore(reject, e);
        }, delaiMs);
        req.on('data', surDonnee); req.on('end', surFin); req.on('error', surErreur); req.on('aborted', surErreur); req.on('close', surClose);
    });
}

function decouper(corps, boundary) {
    const delim = Buffer.from(`--${boundary}`), sep = Buffer.from(`\r\n--${boundary}`);
    if (corps.compare(delim, 0, delim.length, 0, delim.length) !== 0) throw entree('multipart');   // ni préambule ni autre contenu
    const parties = [];
    let pos = delim.length;
    for (;;) {
        // après un délimiteur : `--` (+ CRLF final facultatif) ferme, CRLF ouvre une partie, tout le reste est refusé
        if (corps.toString('latin1', pos, pos + 2) === '--') {
            const reste = corps.subarray(pos + 2);
            if (reste.length === 0 || reste.equals(CRLF)) return parties;
            throw entree('multipart');
        }
        if (!corps.subarray(pos, pos + 2).equals(CRLF)) throw entree('multipart');
        pos += 2;
        const finPartie = corps.indexOf(sep, pos);
        if (finPartie === -1) throw entree('multipart');                // pas de fermeture
        parties.push(corps.subarray(pos, finPartie));
        if (parties.length > PARTIES_MAX) throw entree('multipart');
        pos = finPartie + sep.length;
    }
}

// Paramètres `; clé=valeur` ou `; clé="valeur"` : les valeurs entre guillemets sont lues comme des unités (un `name=` à
// l'intérieur d'un filename n'est jamais un paramètre). Tout ce qui ne se lit pas entièrement est refusé.
function parametres(texte) {
    const re = /\s*;\s*([A-Za-z0-9_*-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s;"]*))/y;
    const liste = []; let pos = 0;
    while (pos < texte.length) {
        re.lastIndex = pos;
        const m = re.exec(texte);
        if (!m) throw entree('multipart');
        liste.push([m[1].toLowerCase(), m[2] !== undefined ? m[2] : m[3]]);
        pos = re.lastIndex;
    }
    return liste;
}

function nomDePartie(partie) {
    const finTete = partie.indexOf(CRLF2);
    if (finTete === -1) throw entree('multipart');
    const lignes = partie.toString('latin1', 0, finTete).split('\r\n');
    const disp = lignes.find(l => /^content-disposition\s*:/i.test(l));
    if (!disp) throw entree('multipart');
    const m = /^content-disposition\s*:\s*form-data(.*?)\s*$/i.exec(disp);   // espaces finaux tolérés
    if (!m) throw entree('multipart');
    const noms = parametres(m[1]).filter(([k]) => k === 'name');     // le filename n'est jamais exploité
    if (noms.length !== 1) throw entree('multipart');
    return { nom: noms[0][1], contenu: partie.subarray(finTete + CRLF2.length) };
}

async function lireMultipart(req, { octetsMax = lireConfig().images.scannerOctetsMax, delaiMs = DELAI_LECTURE_MS,
    minuterie = { set: (f, ms) => { const t = setTimeout(f, ms); if (t.unref) t.unref(); return t; }, clear: t => clearTimeout(t) } } = {}) {
    const corps = await lireCorps(req, octetsMax, delaiMs, minuterie);
    if (corps.length === 0) throw image('aucune-carte', 422);
    const parties = decouper(corps, boundaryDe(req.headers['content-type'])).map(nomDePartie);
    let source = null, img = null;
    for (const p of parties) {
        if (p.nom === 'source') { if (source !== null) throw entree('source-en-double'); source = p.contenu.toString('utf8'); }
        else if (p.nom === 'image') { if (img !== null) throw entree('image-en-double'); img = p.contenu; }
        else throw entree('champ-inconnu');
    }
    if (source === null || !SOURCES.includes(source)) throw entree('source');
    if (img === null || img.length === 0) throw image('aucune-carte', 422);
    if (img.length > octetsMax) throw image('trop-lourde', 413);
    const type = typeDesOctets(img);
    if (!type) throw image('format', 415);
    return { champs: { source }, image: { buffer: Buffer.from(img), type } };
}

module.exports = { lireMultipart, SOURCES, ErreurMultipart, PARTIES_MAX, MARGE_ENTETES_OCTETS, DELAI_LECTURE_MS };
