'use strict';
// SECONDE-LECTURE — les pièces qui touchent l'image et le modèle, ADAPTÉES du labo (pokemon-proxy-labo/seconde-lecture.js, calibré au §72).
// 🔴 AUCUN TÉLÉCHARGEMENT (décision 4 du testeur, tour 1) : ce module ne fait JAMAIS de requête serveur vers une photo (Vinted ou autre). L'image arrive en OCTETS, fournie par l'appelant
// (plus tard l'extension, dans la re-mesure le jeu de photos). Son seul client réseau est le `post` INJECTÉ du lecteur du modèle (les bancs n'appellent jamais rien de payant) ; un banc
// (test-seconde-lecture-image.js §5) échoue si un client réseau y est importé ou appelé. Rien ici n'est branché par défaut : voir monter.js.
//   · redresser(photo, geometrie)  la carte redressée en haute définition depuis la photo ORIGINALE (le redressé de la chaîne vient d'une image réduite à 640 px) ;
//   · bandes(carte)                trois recadrages DISTINCTS du bas de la carte (20 %, 32 %, et 26 % contrasté) — jamais deux essais au même crop (erreurs corrélées) ;
//   · creerLecteur({post,modele,cle}) le modèle : DEUX champs (code du set, numéro), rien d'autre ; l'erreur levée ne porte jamais la clé ; un signal d'abandon est transmis au client ;
//   · creerRecadreur({largeur})    octets de l'image → bandes : géométrie EXIGÉE (sans elle, ou sans octets, aucune bande).

const MT = require('./marques-tampon');                                                    // LOT TAMPONS : la liste fermée des marques (module PUR)
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
    // MEMOIRE-G : chaque Mat est créé DANS le try — une création qui échoue (la transformation de perspective, par exemple) ne laisse pas les précédentes vivantes
    let src = null, s = null, d = null, M = null, out = null;
    try {
        src = new cv.Mat(info.height, info.width, cv.CV_8UC3); src.data.set(data);
        s = cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap(p => [p.x, p.y]));
        d = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, largeur, 0, largeur, hauteur, 0, hauteur]);
        M = cv.getPerspectiveTransform(s, d);
        out = new cv.Mat();
        cv.warpPerspective(src, out, M, new cv.Size(largeur, hauteur), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
        return await sharp(Buffer.from(out.data), { raw: { width: largeur, height: hauteur, channels: 3 } }).png().toBuffer();
    } finally { [src, s, d, M, out].forEach(m => { try { if (m && !m.isDeleted()) m.delete(); } catch (_) { /* déjà libéré */ } }); }
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

/**
 * L'appel au modèle, UN seul exemplaire (seconde lecture ET lecture du tampon, F1-TAMPON) : une consigne, une image JPEG, la réponse brute. `post(url, corps, config)` est un client axios-compatible ;
 * `surUsage(usage)` (la MESURE seulement) demande le coût réel au fournisseur et le rend ; sans lui, la requête est exactement celle d'avant. @returns la réponse brute (texte) */
function creerAppel({ post, modele, cle, prompt, surUsage, nom }) {
    if (typeof post !== 'function' || typeof modele !== 'string' || !modele || typeof cle !== 'string' || !cle) throw new Error(`${nom} : post, modele et cle sont obligatoires`);
    return async function appeler(bande, { signal } = {}) {
        let r;
        try {
            r = await post('https://openrouter.ai/api/v1/chat/completions', {
                model: modele, temperature: 0, ...(typeof surUsage === 'function' ? { usage: { include: true } } : {}),
                messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(bande).toString('base64')}` } }] }]
            }, { headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' }, timeout: 30000, ...(signal ? { signal } : {}) });     // le signal d'abandon (délai de la route) interrompt l'appel en vol
        } catch (e) {
            throw Object.assign(new Error('seconde lecture : appel du modèle en échec'), { code: (e && typeof e.code === 'string' && /^[A-Z_0-9]{2,40}$/.test(e.code)) ? e.code : 'APPEL_MODELE' });     // jamais le message d'origine : il peut contenir l'en-tête
        }
        if (typeof surUsage === 'function') { try { surUsage(r && r.data && r.data.usage ? r.data.usage : null); } catch { /* une mesure qui échoue ne change pas la lecture */ } }
        const [choix] = (r && r.data && Array.isArray(r.data.choices) && r.data.choices) || [];
        const { message: reponse } = choix || {};                                    // la réponse du MODÈLE (pas une erreur) : déstructurée, la règle « aucun .message » ne la confond pas avec un message d'exception
        return String((reponse && reponse.content) || '');
    };
}
const jsonDe = brut => { let p = null; try { p = JSON.parse(String(brut).replace(/```json|```/g, '').trim()); } catch { /* illisible */ } return p && typeof p === 'object' && !Array.isArray(p) ? p : null; };

/** Le lecteur du modèle. `post(url, corps, config)` est un client axios-compatible ; `modele` et `cle` sont OBLIGATOIRES. Rend { setCode, number, total } ou { illisible: true }. */
function creerLecteur({ post, modele, cle, surUsage } = {}) {
    const appeler = creerAppel({ post, modele, cle, prompt: PROMPT, surUsage, nom: 'creerLecteur' });
    return async function lire(bande, opts = {}) {
        const p = jsonDe(await appeler(bande, opts));
        if (!p) return { illisible: true };
        return { setCode: p.setCode ?? null, number: p.number ?? null, total: p.total ?? null };
    };
}

// ── F1-TAMPON puis LOT TAMPONS : UNE question sur la carte entière — quelles MARQUES (tampons, logos d'événement ou d'enseigne ajoutés sur la carte) sont visibles, dans la LISTE FERMÉE de marques-tampon.js ?
// La certitude est exigée : une marque n'est listée que si elle se voit clairement. Tout tampon hors de la liste se dit « other » (une question côté chaîne), une image qui ne permet pas de décider « unclear ».
// Les descriptions sont écrites UNE fois par marque ; un module qui oublie une marque de la liste (ou en décrit une de trop) ne se charge pas.
const DESCRIPTION_MARQUE = Object.freeze({
    staff: 'the word STAFF stamped on the card',
    prerelease: 'the word PRERELEASE or PRE-RELEASE stamped on the card',
    league: 'a Pokémon League logo stamp',
    championship: 'a Championships stamp (national, regional or world championship)',
    'toys-r-us': 'the Toys "R" Us logo stamp',
    gamestop: 'the GameStop logo stamp',
    kfc: 'the KFC logo stamp',
    indomilk: 'the Indomilk logo or word stamp',
    professor: 'a Pokémon Professor stamp',
    cosmo: 'a cosmos / galaxy holo foil pattern stamped over the card (not the holo foil of the card itself)',
    snowflake: 'a snowflake stamp',
    'play-pokemon': 'a "Play! Pokémon" stamp',
    'place-1': 'a stamp for 1st place', 'place-2': 'a stamp for 2nd place', 'place-3': 'a stamp for 3rd place', 'place-4': 'a stamp for 4th place'
});
if (MT.MARQUES.length !== Object.keys(DESCRIPTION_MARQUE).length || !MT.MARQUES.every(m => typeof DESCRIPTION_MARQUE[m] === 'string')) throw new Error('seconde-lecture-image : la consigne des marques ne décrit pas exactement la liste fermée');
const PROMPT_TAMPON = `This image is a Pokémon trading card (a photo or a scan, possibly blurry or at an angle).
Question: which promotional stamps or marks are printed or stamped ON the card itself (a logo or word added on the artwork or the border, as on event, promo or store versions of a card)?
Choose ONLY from this closed list of ids:
${MT.MARQUES.map(m => `- "${m}": ${DESCRIPTION_MARQUE[m]}`).join('\n')}
Rules: list a mark ONLY if you can clearly see it on the card. What belongs to every normal copy of the card (set symbol, regulation mark, rarity symbol, copyright line, the card's own holo foil, "1st Edition") is NOT a stamp.
If you see any stamp or logo that is not in the list, set "other" to true. If the image is too blurry, cropped, dark or unclear to decide, set "unclear" to true.
If the whole card is clearly visible and carries no stamp, return an empty list. Never guess.
Reply ONLY with JSON: {"stamps": [ids from the list], "other": true | false, "unclear": true | false}`;
const MARQUES_PAR_LECTURE_MAX = 12;

/**
 * Le lecteur des marques. Rend { marques: string[], autre: boolean, incertain: boolean } (les chaînes TELLES QUE LUES : la décision les juge, lecture-tampon.js::essaiDe) ou { illisible: true } pour toute
 * forme qui n'est pas EXACTEMENT celle-là (jamais une marque inventée, jamais un champ manquant pris pour « faux »).
 */
function creerLecteurTampon({ post, modele, cle, surUsage } = {}) {
    const appeler = creerAppel({ post, modele, cle, prompt: PROMPT_TAMPON, surUsage, nom: 'creerLecteurTampon' });
    return async function lireTampon(bande, opts = {}) {
        const p = jsonDe(await appeler(bande, opts));
        const forme = p && Array.isArray(p.stamps) && p.stamps.length <= MARQUES_PAR_LECTURE_MAX && p.stamps.every(x => typeof x === 'string') && typeof p.other === 'boolean' && typeof p.unclear === 'boolean';
        return forme ? { marques: p.stamps.map(x => x.trim()), autre: p.other, incertain: p.unclear } : { illisible: true };
    };
}

const LARGEURS_TAMPON = Object.freeze([1000, 1400]);
/**
 * La préparation de l'image du tampon : DEUX images JPEG de la carte ENTIÈRE, de définitions distinctes (1000 et 1400 px de large, la seconde contrastée), pour deux essais qui ne lisent pas la même chose.
 * `image` : les octets de l'APPELANT, et SEULEMENT la carte redressée validée de MODELE-VISUEL-API (JPEG 420 x 587) : une image d'une autre taille (une photo pleine, deux cartes côte à côte) est REFUSÉE (lève).
 * Pas de géométrie, pas de redressement ici. Sans octets : []. Des octets illisibles : lève. Jamais un téléchargement.
 */
const CARTE_L = 420, CARTE_H = 587;
function creerPreparateurTampon() {
    return async function preparer({ image } = {}) {
        if (!Buffer.isBuffer(image) || !image.length) return [];
        const sharp = require('sharp');
        const m = await sharp(image, { failOn: 'error', limitInputPixels: 50e6 }).metadata();
        if (m.width !== CARTE_L || m.height !== CARTE_H) throw Object.assign(new Error('carte hors format'), { code: 'CARTE_HORS_FORMAT' });
        return Promise.all(LARGEURS_TAMPON.map((largeur, i) => {
            let img = sharp(image).resize({ width: largeur });
            if (i === 1) img = img.normalise().sharpen({ sigma: 1.0 });
            return img.jpeg({ quality: 92 }).toBuffer();
        }));
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

module.exports = { redresser, bandes, creerLecteur, creerRecadreur, creerLecteurTampon, creerPreparateurTampon, PROMPT, PROMPT_TAMPON, BANDES };
