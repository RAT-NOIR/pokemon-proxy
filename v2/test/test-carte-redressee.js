'use strict';
// Banc MODELE-VISUEL-API tour 1 (1) — la CARTE REDRESSÉE que l'extension joint à son vecteur : ce que le serveur AUTORISE (un JPEG, SOI et EOI, décodable par sharp, EXACTEMENT 420 × 587, une seule page, au plus 200 Ko décodés,
// base64 canonique), et rien d'autre. Tout le reste : { ok:false, code } — la garde des zones ne peut pas conclure. Les JPEG sont FABRIQUÉS par sharp (bruit à graine fixe) ; aucune donnée réelle.
const H = require('./_harnais');
const sharp = require('sharp');
const C = require('../identifier/carte-redressee');

function bruit(w, h, graine = 7) { let x = graine >>> 0; const b = Buffer.alloc(w * h * 3); for (let i = 0; i < b.length; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; b[i] = (x >>> 24) & 0xff; } return b; }
const jpeg = (w, h, q = 92) => sharp(bruit(w, h), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: q }).toBuffer();
const b64 = b => b.toString('base64');

(async () => {
    H.v('0. constantes : 420 × 587, 200 Ko décodés (borne nommée), base64 de 273 068 caractères au plus', [C.LARGEUR, C.HAUTEUR, C.OCTETS_MAX, C.BASE64_MAX], [420, 587, 204800, 273068]);
    const bon = await jpeg(420, 587, 40);                                         // qualité basse : sous la borne malgré le bruit
    H.vrai(`contrôle du banc : le JPEG fabriqué pèse moins de 200 Ko (${bon.length} octets)`, bon.length < C.OCTETS_MAX);
    const ok = await C.valider(b64(bon));
    H.v('1a. un JPEG 420 × 587 : ok, 420 × 587, les pixels RGB (420 × 587 × 3 octets)', [ok.ok, ok.width, ok.height, ok.data && ok.data.length], [true, 420, 587, 420 * 587 * 3]);
    const ko = async (nom, entree, code) => { let r; try { r = await C.valider(entree); } catch (e) { r = { leve: String(e.message) }; } H.v(nom, r.ok === false ? r.code : r, code); };
    await ko('2a. absente (undefined)', undefined, 'absente');
    await ko('2b. absente (null)', null, 'absente');
    await ko('2c. pas une chaîne', 12345, 'forme');
    await ko('2d. chaîne vide', '', 'forme');
    await ko('2e. base64 non canonique (un espace glissé)', b64(bon).slice(0, 100) + ' ' + b64(bon).slice(100), 'forme');
    await ko('2f. base64 URL (tiret)', 'AAAA-AAA', 'forme');
    await ko('2g. plus de 273 068 caractères : refusée sans être décodée', 'A'.repeat(C.BASE64_MAX + 4), 'taille');
    const gros = await jpeg(420, 587, 100);
    H.vrai(`contrôle du banc : le JPEG q100 fabriqué dépasse 200 Ko (${gros.length} octets)`, gros.length > C.OCTETS_MAX);
    await ko('3a. un JPEG de plus de 200 Ko décodés', b64(gros), 'taille');
    await ko('3b. un JPEG d\'une autre taille (419 × 587)', b64(await jpeg(419, 587, 40)), 'dimensions');
    await ko('3c. un JPEG d\'une autre taille (420 × 588)', b64(await jpeg(420, 588, 40)), 'dimensions');
    await ko('3d. un JPEG paysage (587 × 420)', b64(await jpeg(587, 420, 40)), 'dimensions');
    await ko('3e. un PNG 420 × 587 (pas un JPEG)', b64(await sharp({ create: { width: 420, height: 587, channels: 3, background: '#808080' } }).png().toBuffer()), 'format');
    await ko('3f. un WebP 420 × 587', b64(await sharp({ create: { width: 420, height: 587, channels: 3, background: '#808080' } }).webp().toBuffer()), 'format');
    await ko('3g. un JPEG tronqué (sans EOI)', b64(bon.subarray(0, bon.length - 2)), 'format');
    await ko('3h. un JPEG sans SOI (premier octet changé)', b64(Buffer.concat([Buffer.from([0x00]), bon.subarray(1)])), 'format');
    await ko('3i. un JPEG dont le corps est corrompu (EOI présent, données mortes)', b64(Buffer.concat([bon.subarray(0, 700), Buffer.alloc(bon.length - 702, 0x5a), Buffer.from([0xff, 0xd9])])), 'decodage');
    await ko('3j. du texte', Buffer.from('pas une image du tout, juste du texte').toString('base64'), 'format');
    // variante du banc qui affirme l'inverse : la même assertion sur une carte BONNE doit réussir — elle ne peut donc pas passer par défaut
    const autre = await C.valider(b64(await jpeg(420, 587, 30)));
    H.v('4. contrôle de l\'instrument : une autre carte bonne est acceptée (les refus ci-dessus ne viennent pas d\'un validateur qui refuse tout)', autre.ok, true);
    H.v('5. la liste fermée des codes de refus', C.CODES, ['absente', 'forme', 'taille', 'format', 'dimensions', 'decodage']);
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
