'use strict';
// MODELE-VISUEL-API tour 1 — la CARTE REDRESSÉE que l'extension joint à son vecteur (`empreintes[i].carte`) : les PIXELS de la garde des zones. Décision du coordinateur (2026-10-18) : c'est la carte DONT l'extension a tiré
// le vecteur (420 × 587, JPEG qualité 0,92) — la configuration mesurée à 0 faux ; le serveur ne télécharge jamais la photo et ne la redresse pas lui-même (son recadrage différerait de celui du vecteur).
// 🔑 Écrit par ce qu'il AUTORISE : une chaîne base64 canonique de 273 068 caractères au plus ; qui se décode en au plus OCTETS_MAX (200 Ko) ; qui commence par SOI (FF D8) et finit par EOI (FF D9) ; que sharp reconnaît comme JPEG,
// d'UNE page, de EXACTEMENT 420 × 587 ; et que sharp décode entièrement. Tout le reste rend { ok:false, code } (liste fermée) : la garde des zones ne peut pas conclure, donc la règle G se tait pour cette photo.
// Ne lève jamais. Aucun octet n'est écrit ni gardé : on rend les pixels RGB de CETTE requête.
const LARGEUR = 420, HAUTEUR = 587, OCTETS_MAX = 200 * 1024, BASE64_MAX = Math.ceil(OCTETS_MAX / 3) * 4;
const CODES = Object.freeze(['absente', 'forme', 'taille', 'format', 'dimensions', 'decodage']);
const echec = code => ({ ok: false, code });
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** @returns {Promise<{ok:true, data:Buffer, width:420, height:587} | {ok:false, code:string}>} */
async function valider(chaine) {
    try {
        if (chaine === undefined || chaine === null) return echec('absente');
        if (typeof chaine !== 'string' || chaine.length === 0 || chaine.length % 4 !== 0 || !BASE64.test(chaine)) return echec('forme');
        if (chaine.length > BASE64_MAX) return echec('taille');
        const octets = Buffer.from(chaine, 'base64');
        if (octets.toString('base64') !== chaine) return echec('forme');
        if (octets.length > OCTETS_MAX) return echec('taille');
        if (octets.length < 4 || octets[0] !== 0xff || octets[1] !== 0xd8 || octets[octets.length - 2] !== 0xff || octets[octets.length - 1] !== 0xd9) return echec('format');
        const sharp = require('sharp');
        let meta;
        try { meta = await sharp(octets, { limitInputPixels: LARGEUR * HAUTEUR * 4, pages: 1 }).metadata(); } catch { return echec('format'); }
        if (meta.format !== 'jpeg' || (meta.pages && meta.pages > 1)) return echec('format');
        if (meta.width !== LARGEUR || meta.height !== HAUTEUR) return echec('dimensions');
        let r;
        try { r = await sharp(octets, { limitInputPixels: LARGEUR * HAUTEUR * 4 }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true }); } catch { return echec('decodage'); }
        if (r.info.width !== LARGEUR || r.info.height !== HAUTEUR || r.info.channels !== 3 || r.data.length !== LARGEUR * HAUTEUR * 3) return echec('decodage');
        return { ok: true, data: r.data, width: LARGEUR, height: HAUTEUR };
    } catch { return echec('decodage'); }
}

module.exports = { valider, LARGEUR, HAUTEUR, OCTETS_MAX, BASE64_MAX, CODES };
