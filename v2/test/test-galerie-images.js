'use strict';
// GALERIE — la validation et la recompression d'une image. Le type se lit à la SIGNATURE D'OCTETS ; jamais de SVG, jamais d'image animée ; bornes de pixels et d'octets ; sortie recompressée sans métadonnées.
// Des images FABRIQUÉES (sharp, octets écrits à la main pour l'animé), des copies MUTÉES du module : la même scène doit changer de résultat quand une garde est retirée.
const { charger, H } = require('./_aide-galerie');
const sharp = require('sharp'), zlib = require('zlib');
const I = require('../galerie/images');

const BORNES = { pixelsMax: 24e6, octetsMax: 8 * 1024 * 1024 };
const uni = (w, h, bg = { r: 220, g: 20, b: 20 }) => ({ create: { width: w, height: h, channels: 3, background: bg } });
const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(data.length); c.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([l, t, data, c]); };
const ENTETE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = (w, h) => { const d = Buffer.alloc(13); d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4); d[8] = 8; d[9] = 2; return chunk('IHDR', d); };
const essai = async (octets, o = {}) => { try { return { ok: await I.traiter(octets, { ...BORNES, ...o }) }; } catch (e) { return { detail: e.detail, statut: e.statut, nom: e.name }; } };

(async () => {
    const rouge = { jpeg: await sharp(uni(300, 420)).jpeg().toBuffer(), png: await sharp(uni(300, 420)).png().toBuffer(), webp: await sharp(uni(300, 420)).webp().toBuffer() };

    // ═══ 1. le type se lit à la SIGNATURE ═══
    H.v('1. signatures : JPEG, PNG, WebP reconnus ; le reste non', [I.formatParSignature(rouge.jpeg), I.formatParSignature(rouge.png), I.formatParSignature(rouge.webp), I.formatParSignature(Buffer.from('GIF89a......')), I.formatParSignature(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), I.formatParSignature(Buffer.alloc(0)), I.formatParSignature('texte')],
        ['jpeg', 'png', 'webp', null, null, null, null]);
    for (const f of ['jpeg', 'png', 'webp']) {
        const r = await essai(rouge[f], { declare: `image/${f}` });
        H.v(`   ${f} valide : recompressé en WebP, ${r.ok && r.ok.largeur}×${r.ok && r.ok.hauteur}, couleur dominante rouge`, [!!r.ok, r.ok && I.formatParSignature(r.ok.image), r.ok && I.formatParSignature(r.ok.vignette), r.ok && /^#[0-9a-f]{6}$/.test(r.ok.couleur) && parseInt(r.ok.couleur.slice(1, 3), 16) > 180], [true, 'webp', 'webp', true]);
    }
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script><rect width="100" height="100" fill="red"/></svg>');
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
    H.v('   un SVG (même déclaré image/png) est refusé : FICHIER format, 415', [(await essai(svg, { declare: 'image/png' })).detail, (await essai(svg)).statut], ['format', 415]);
    H.v('   un GIF est refusé : format', (await essai(gif)).detail, 'format');
    H.v('   des octets PNG déclarés image/jpeg : refus format (le Content-Type du client ne fait pas foi)', (await essai(rouge.png, { declare: 'image/jpeg' })).detail, 'format');
    H.v('   un SVG déguisé sous l\'entête d\'un PNG (signature PNG + XML) : illisible, jamais rendu', (await essai(Buffer.concat([ENTETE_PNG, svg]))).detail, 'illisible');
    H.v('   vide ou texte : illisible', [(await essai(Buffer.alloc(0))).detail, (await essai(Buffer.from('x'))).detail], ['illisible', 'format']);

    // ═══ 2. jamais animé ═══
    const apng = Buffer.concat([ENTETE_PNG, ihdr(8, 8), chunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])), chunk('IDAT', zlib.deflateSync(Buffer.alloc(8 * (1 + 24)))), chunk('IEND', Buffer.alloc(0))]);
    const riff = (chunks) => { const corps = Buffer.concat([Buffer.from('WEBP'), ...chunks]); const e = Buffer.alloc(8); e.write('RIFF', 0, 'latin1'); e.writeUInt32LE(corps.length, 4); return Buffer.concat([e, corps]); };
    const wchunk = (type, data) => { const e = Buffer.alloc(8); e.write(type, 0, 'latin1'); e.writeUInt32LE(data.length, 4); return Buffer.concat([e, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
    const webpAnime = riff([wchunk('VP8X', Buffer.from([0x02, 0, 0, 0, 7, 0, 0, 7, 0, 0])), wchunk('ANIM', Buffer.alloc(6))]);
    const webpFixeVp8x = riff([wchunk('VP8X', Buffer.from([0x00, 0, 0, 0, 7, 0, 0, 7, 0, 0])), wchunk('VP8L', Buffer.alloc(10))]);
    H.v('2. PNG animé (bloc acTL) et WebP animé (drapeau VP8X, bloc ANIM) : détectés ; un PNG et un WebP FIXES non', [I.estAnime(apng, 'png'), I.estAnime(webpAnime, 'webp'), I.estAnime(rouge.png, 'png'), I.estAnime(rouge.webp, 'webp'), I.estAnime(webpFixeVp8x, 'webp')], [true, true, false, false, false]);
    H.v('   le refus : FICHIER animee, 422, pour l\'un et l\'autre', [await essai(apng), await essai(webpAnime)].map(r => [r.detail, r.statut]), [['animee', 422], ['animee', 422]]);
    {   // un vrai WebP animé fabriqué par sharp, s'il sait le faire
        let anime = null; try { anime = await sharp([await sharp(uni(16, 16)).png().toBuffer(), await sharp(uni(16, 16, { r: 0, g: 0, b: 200 })).png().toBuffer()], { join: { animated: true } }).webp({ delay: [100, 100], loop: 0 }).toBuffer(); } catch { anime = null; }
        if (anime) H.v('   un vrai WebP animé produit par sharp : refusé animee', (await essai(anime)).detail, 'animee'); else console.log('   (sharp ne fabrique pas de WebP animé ici : le cas est couvert par les octets écrits à la main)');
    }

    // ═══ 3. les bornes ═══
    H.v('3. trop de pixels (1 200 × 1 000 pour une borne de 1 Mpx) : 422 trop-de-pixels, avant tout décodage', (r => [r.detail, r.statut])(await essai(await sharp(uni(1200, 1000)).png().toBuffer(), { pixelsMax: 1e6 })), ['trop-de-pixels', 422]);
    H.v('   pile à la borne (1 000 × 1 000 pour 1 Mpx) : admise', !!(await essai(await sharp(uni(1000, 1000)).png().toBuffer(), { pixelsMax: 1e6 })).ok, true);
    H.v('   trop lourd (la borne en octets) : 413 trop-lourde', (r => [r.detail, r.statut])(await essai(rouge.png, { octetsMax: 100 })), ['trop-lourde', 413]);
    H.v('   illisible : en-tête de JPEG puis du bruit ; PNG à l\'IDAT corrompu ; PNG tronqué en deux', (await Promise.all([
        essai(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), require('crypto').randomBytes(120)])),
        essai(Buffer.concat([ENTETE_PNG, ihdr(40, 40), chunk('IDAT', require('crypto').randomBytes(200)), chunk('IEND', Buffer.alloc(0))])),
        essai(rouge.png.subarray(0, 60))
    ])).map(r => r.detail), ['illisible', 'illisible', 'illisible']);

    // ═══ 4. la sortie : recompressée, redimensionnée, SANS métadonnées, orientation appliquée ═══
    {
        const grande = await sharp(uni(3000, 1500)).jpeg().toBuffer();
        const r = await essai(grande);
        H.v('4. une image de 3 000 × 1 500 sort à 2 000 × 1 000 (2 000 px au plus sur le grand côté), vignette ≤ 480', [r.ok.largeur, r.ok.hauteur, (await sharp(r.ok.vignette).metadata()).width], [2000, 1000, 480]);
        const petite = await essai(rouge.png);
        H.v('   une petite image n\'est JAMAIS agrandie', [petite.ok.largeur, petite.ok.hauteur], [300, 420]);
        let avecMeta = null;
        try { avecMeta = await sharp(uni(300, 420)).withExif({ IFD0: { Copyright: 'MOT-SECRET-A-NE-PAS-GARDER', Artist: 'Quelqu\'un' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer(); } catch { avecMeta = await sharp(uni(300, 420)).withMetadata({ orientation: 6 }).jpeg().toBuffer(); }
        const m0 = await sharp(avecMeta).metadata();
        const t = await essai(avecMeta);
        const m1 = await sharp(t.ok.image).metadata();
        H.v('   l\'orientation EXIF (6) est APPLIQUÉE : 300 × 420 sort 420 × 300', [m0.orientation, t.ok.largeur, t.ok.hauteur], [6, 420, 300]);
        H.v('   AUCUNE métadonnée en sortie (ni EXIF, ni XMP, ni IPTC, ni ICC), et le texte de l\'EXIF n\'est nulle part dans les octets', [m1.exif, m1.xmp, m1.iptc, t.ok.image.includes('MOT-SECRET') || t.ok.vignette.includes('MOT-SECRET')], [undefined, undefined, undefined, false]);
    }

    // ═══ 5. UNE recompression à la fois ═══
    {
        let lache; const bloque = new Promise(r => { lache = r; });
        const a = I.sousVerrou(async () => { await bloque; return 'a'; });
        const b = await I.sousVerrou(async () => 'b');
        lache(); const ra = await a;
        const c = await I.sousVerrou(async () => 'c');
        H.v('5. une seule recompression à la fois : la seconde, pendant la première, est « occupée » ; après, elle passe', [ra.valeur, b.occupe, c.valeur], ['a', true, 'c']);
    }

    // ═══ 6. MUTATIONS : retirer une garde doit changer le résultat ═══
    {
        const m1 = charger('images.js', [["if (!format) throw refus('format');", '']]);
        const sansSig = await m1.traiter(svg, { ...BORNES }).then(() => 'ACCEPTÉ', e => `refus ${e.detail}`);
        H.v('6. MUTANT « la signature d\'octets n\'est plus exigée » : le SVG, refusé par le réel, est RENDU en WebP par le mutant', [(await essai(svg)).detail, sansSig], ['format', 'ACCEPTÉ']);
        const m2 = charger('images.js', [["if (estAnime(octets, format)) throw refus('animee');", '']]);
        H.v('   MUTANT « l\'animé n\'est plus refusé » : le PNG animé passe', [(await essai(apng)).detail, await m2.traiter(apng, { ...BORNES }).then(() => 'ACCEPTÉ', e => `refus ${e.detail}`)], ['animee', 'ACCEPTÉ']);
        const lourde = await sharp(uni(1200, 1000)).png().toBuffer();
        const m3 = charger('images.js', [['if (meta.width * meta.height > pixelsMax) throw refus(\'trop-de-pixels\');', ''], ['limitInputPixels: pixelsMax, failOn', 'limitInputPixels: false, failOn']]);
        H.v('   MUTANT « la borne de pixels n\'est ni lue dans l\'en-tête ni donnée au décodeur » : l\'image trop grande passe', [(await essai(lourde, { pixelsMax: 1e6 })).detail, await m3.traiter(lourde, { pixelsMax: 1e6, octetsMax: BORNES.octetsMax }).then(() => 'ACCEPTÉ', e => `refus ${e.detail}`)], ['trop-de-pixels', 'ACCEPTÉ']);
        const m4 = charger('images.js', [['if (octets.length > octetsMax) throw refus(\'trop-lourde\');', '']]);
        H.v('   MUTANT « la borne d\'octets est retirée » : l\'image trop lourde passe', [(await essai(rouge.png, { octetsMax: 100 })).detail, await m4.traiter(rouge.png, { ...BORNES, octetsMax: 100 }).then(() => 'ACCEPTÉ', e => `refus ${e.detail}`)], ['trop-lourde', 'ACCEPTÉ']);
        const m5 = charger('images.js', [['if (declare && TYPES[declare] !== format) throw refus(\'format\');', '']]);
        H.v('   MUTANT « le type déclaré n\'est plus comparé à la signature » : le PNG déclaré JPEG passe', [(await essai(rouge.png, { declare: 'image/jpeg' })).detail, await m5.traiter(rouge.png, { ...BORNES, declare: 'image/jpeg' }).then(() => 'ACCEPTÉ', e => `refus ${e.detail}`)], ['format', 'ACCEPTÉ']);
    }
    H.bilan();
})();
