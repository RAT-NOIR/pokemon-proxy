'use strict';
// SECONDE-LECTURE — les pièces qui touchent l'image et le modèle, ADAPTÉES du labo (pokemon-proxy-labo/seconde-lecture.js, calibré au §72).
// 🔴 AUCUN TÉLÉCHARGEMENT (décision 4 du testeur, tour 1) : ce module ne fait JAMAIS de requête serveur vers une photo (Vinted ou autre). L'image arrive en OCTETS, fournie par l'appelant
// (plus tard l'extension, dans la re-mesure le jeu de photos). Son seul client réseau est le `post` INJECTÉ du lecteur du modèle (les bancs n'appellent jamais rien de payant) ; un banc
// (test-seconde-lecture-image.js §5) échoue si un client réseau y est importé ou appelé. Rien ici n'est branché par défaut : voir monter.js.
//   · redresser(photo, geometrie)  la carte redressée en haute définition depuis la photo ORIGINALE (le redressé de la chaîne vient d'une image réduite à 640 px) ;
//   · bandes(carte)                trois recadrages DISTINCTS du bas de la carte (20 %, 32 %, et 26 % contrasté) — jamais deux essais au même crop (erreurs corrélées) ;
//   · creerLecteur({post,modele,cle}) le modèle : DEUX champs (code du set, numéro), rien d'autre ; l'erreur levée ne porte jamais la clé ; un signal d'abandon est transmis au client ;
//   · creerRecadreur({largeur})    octets de l'image → bandes : géométrie EXIGÉE (sans elle, ou sans octets, aucune bande).

// La consigne du labo (VERSION v1-2026-10-04) : deux champs, jamais le nom ni le titre — la lecture reste indépendante de la première.
const PROMPT = `This image is the BOTTOM EDGE of a Pokémon trading card (a photo, possibly blurry or at an angle).
Read ONLY two printed things:
1. the SET CODE: the small expansion code printed near the card number, e.g. "SVI", "PAL", "OBF", "MEW", "sv4a", "SV2a", "s8b", "SM12a", "SWSH" (on promos), "TG". Do NOT return the single regulation letter (D, E, F, G, H...), the language code (EN, FR, DE, JP...) or the rarity symbol. If no set code is printed (only a set symbol), return null.
2. the CARD NUMBER as printed, e.g. "123/165", "045/SV-P", "SWSH050", "TG12/TG30", "001/078", "25". Split it: "number" is the part before the slash, "total" the part after (null if there is no slash).
Never guess: return null for anything you cannot read with certainty.
Reply ONLY with JSON: {"setCode": string|null, "number": string|null, "total": string|null}`;

const BANDES = Object.freeze([
    { nom: 'bas-20', y0: 0.80 },
    { nom: 'bas-32', y0: 0.68 },
    { nom: 'bas-26-contraste', y0: 0.74, contraste: true }
]);
const LARGEUR_BANDE = 1600;

let _outils = null;
async function outils() {
    if (_outils) return _outils;
    const sharp = require('sharp');
    const cv = await require('@techstark/opencv-js');
    if (typeof cv.Mat !== 'function') throw new Error('opencv-js chargé mais non initialisé');
    return (_outils = { sharp, cv });
}

/** La carte redressée en haute définition depuis la photo originale. `geo` : { W, quad: [4 points dans l'image W de large], paysage? }. Sans géométrie complète : null. */
async function redresser(photo, geo, { largeur = 1000 } = {}) {
    if (!geo || !Array.isArray(geo.quad) || geo.quad.length !== 4 || !geo.quad.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) || !(geo.W > 0)) return null;
    const { sharp, cv } = await outils();
    // la photo telle que la détection l'a vue (EXIF appliqué), bornée à 2 000 px : les coordonnées du quadrilatère se mettent à l'échelle
    const { data, info } = await sharp(photo).rotate().removeAlpha().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const ech = info.width / geo.W;
    let q = geo.quad.map(p => ({ x: p.x * ech, y: p.y * ech }));
    if (geo.paysage) q = [q[3], q[0], q[1], q[2]];
    const hauteur = Math.round(largeur * 88 / 63);
    const src = new cv.Mat(info.height, info.width, cv.CV_8UC3); src.data.set(data);
    const s = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap(p => [p.x, p.y]));
    const d = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, largeur, 0, largeur, hauteur, 0, hauteur]);
    const M = cv.getPerspectiveTransform(s, d);
    const out = new cv.Mat();
    try {
        cv.warpPerspective(src, out, M, new cv.Size(largeur, hauteur), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
        return await sharp(Buffer.from(out.data), { raw: { width: largeur, height: hauteur, channels: 3 } }).png().toBuffer();
    } finally { [src, s, d, M, out].forEach(m => m.delete()); }
}

/** Les trois bandes (JPEG, 1600 px de large) du bas d'une carte redressée. Lève sur une image illisible. */
async function bandes(carte) {
    const { sharp } = await outils();
    const m = await sharp(carte).metadata();
    return Promise.all(BANDES.map(async b => {
        const top = Math.round(m.height * b.y0);
        let img = sharp(carte).extract({ left: 0, top, width: m.width, height: m.height - top }).resize({ width: LARGEUR_BANDE });
        if (b.contraste) img = img.normalise().sharpen({ sigma: 1.2 }).linear(1.25, -20);
        return img.jpeg({ quality: 92 }).toBuffer();
    }));
}

/** Le lecteur du modèle. `post(url, corps, config)` est un client axios-compatible ; `modele` et `cle` sont OBLIGATOIRES. Rend { setCode, number, total } ou { illisible: true }. */
function creerLecteur({ post, modele, cle } = {}) {
    if (typeof post !== 'function' || typeof modele !== 'string' || !modele || typeof cle !== 'string' || !cle) throw new Error('creerLecteur : post, modele et cle sont obligatoires');
    return async function lire(bande, { signal } = {}) {
        let r;
        try {
            r = await post('https://openrouter.ai/api/v1/chat/completions', {
                model: modele, temperature: 0,
                messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(bande).toString('base64')}` } }] }]
            }, { headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' }, timeout: 30000, ...(signal ? { signal } : {}) });     // le signal d'abandon (délai de la route) interrompt l'appel en vol
        } catch (e) {
            throw Object.assign(new Error('seconde lecture : appel du modèle en échec'), { code: (e && typeof e.code === 'string' && /^[A-Z_0-9]{2,40}$/.test(e.code)) ? e.code : 'APPEL_MODELE' });     // jamais le message d'origine : il peut contenir l'en-tête
        }
        const [choix] = (r && r.data && Array.isArray(r.data.choices) && r.data.choices) || [];
        const { message: reponse } = choix || {};                                    // la réponse du MODÈLE (pas une erreur) : déstructurée, la règle « aucun .message » ne la confond pas avec un message d'exception
        const brut = String((reponse && reponse.content) || '');
        let p = null; try { p = JSON.parse(brut.replace(/```json|```/g, '').trim()); } catch { /* illisible */ }
        if (!p || typeof p !== 'object' || Array.isArray(p)) return { illisible: true };
        return { setCode: p.setCode ?? null, number: p.number ?? null, total: p.total ?? null };
    };
}

/** octets de l'image + corps de la chaîne → bandes. Aucun téléchargement : `image` est un Buffer fourni par l'appelant. La géométrie (corps.geometrie : { W, quad, paysage? }) est EXIGÉE : sans elle, ou sans octets, aucune bande n'est devinée. */
function creerRecadreur({ largeur = 1000 } = {}) {
    return async function recadrer({ image, corps } = {}) {
        const geo = corps && corps.geometrie;
        if (!geo || !Buffer.isBuffer(image) || !image.length) return [];
        const carte = await redresser(image, geo, { largeur });
        return carte ? bandes(carte) : [];
    };
}

module.exports = { redresser, bandes, creerLecteur, creerRecadreur, PROMPT, BANDES };
