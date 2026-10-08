'use strict';
// B9.1 — corps multipart du scanner du site : petit, strict, borné, sans dépendance.
// Accepte exactement deux parties, `source` (liste fermée) et `image` (une seule), et rien d'autre.
// Le corps ENTIER (en-têtes de parties compris) est borné par octetsMax : l'image est donc toujours < octetsMax.
// Le nom de fichier annoncé par le client n'est jamais lu ni conservé : on ne l'extrait pas.
// Erreurs : lève { code, detail, statut } — IMAGE (413/415/422) ou ENTREE (400). Elle ne lève jamais autre chose.
const { lireConfig } = require('../config');

const SOURCES = Object.freeze(['camera', 'fichier', 'collage']);
const CRLF = Buffer.from('\r\n'), CRLF2 = Buffer.from('\r\n\r\n');
const PARTIES_MAX = 8;

class ErreurMultipart extends Error {
    constructor(code, detail, statut) { super(`${code}:${detail}`); this.code = code; this.detail = detail; this.statut = statut; }
}
const image = (detail, statut) => new ErreurMultipart('IMAGE', detail, statut);
const entree = detail => new ErreurMultipart('ENTREE', detail, 400);

// HEIC/HEIF : seulement si la bibliothèque d'images du serveur sait le LIRE (sinon 415, jamais un faux « ok »).
function heifLisible() {
    try { const h = require('sharp').format.heif; return Boolean(h && h.input && (h.input.buffer || h.input.file)); } catch { return false; }
}

// Le format se juge sur les octets, jamais sur le Content-Type ni sur l'extension annoncés.
function typeDesOctets(b, heifPermis) {
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && ['heic', 'heix', 'mif1'].includes(b.toString('latin1', 8, 12))) {
        return heifPermis ? 'image/heic' : null;
    }
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

function lireCorps(req, octetsMax) {
    const cl = req.headers['content-length'];
    if (cl !== undefined) {
        if (!/^\d+$/.test(String(cl))) throw entree('content-length');
        if (Number(cl) > octetsMax) throw image('trop-lourde', 413);       // refus AVANT toute lecture
    }
    return new Promise((resolve, reject) => {
        const morceaux = []; let total = 0, fini = false;
        const nettoyer = () => { req.removeListener('data', surDonnee); req.removeListener('end', surFin); req.removeListener('error', surErreur); req.removeListener('aborted', surCoupure); req.removeListener('close', surClose); };
        const clore = (f, v) => { if (fini) return; fini = true; nettoyer(); f(v); };
        const surDonnee = c => {
            total += c.length;
            if (total > octetsMax) { req.pause(); clore(reject, image('trop-lourde', 413)); return; }   // la lecture s'arrête ici
            morceaux.push(c);
        };
        const surFin = () => clore(resolve, Buffer.concat(morceaux, total));
        const surErreur = () => clore(reject, entree('corps-interrompu'));
        const surCoupure = surErreur;
        const surClose = () => { if (!req.readableEnded) surErreur(); };
        req.on('data', surDonnee); req.on('end', surFin); req.on('error', surErreur); req.on('aborted', surCoupure); req.on('close', surClose);
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

function nomDePartie(partie) {
    const finTete = partie.indexOf(CRLF2);
    if (finTete === -1) throw entree('multipart');
    const lignes = partie.toString('latin1', 0, finTete).split('\r\n');
    const disp = lignes.find(l => /^content-disposition\s*:/i.test(l));
    if (!disp) throw entree('multipart');
    const m = /^content-disposition\s*:\s*form-data\s*((?:;[^;]*)*)$/i.exec(disp);
    const nom = m && /(?:^|;)\s*name="([^"]*)"/i.exec(m[1]);
    if (!nom) throw entree('multipart');
    return { nom: nom[1], contenu: partie.subarray(finTete + CRLF2.length) };   // le filename n'est jamais extrait
}

async function lireMultipart(req, { octetsMax = lireConfig().images.scannerOctetsMax, heifPermis = heifLisible() } = {}) {
    const corps = await lireCorps(req, octetsMax);
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
    const type = typeDesOctets(img, heifPermis);
    if (!type) throw image('format', 415);
    return { champs: { source }, image: { buffer: Buffer.from(img), type } };
}

module.exports = { lireMultipart, SOURCES, ErreurMultipart };
