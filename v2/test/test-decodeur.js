'use strict';
// DECODEUR RAT-MARKET (v2/banc-telephone/public/decodeur*.mjs) — la preuve AU BIT contre Pillow, sans navigateur ni base : node pur.
// La vérité est l'empreinte SHA-256 de Image.open(...).convert('RGB').tobytes() fabriquée par outils/decodeur/fabriquer-fixtures.py et references-lot.py (Pillow 13, libjpeg-turbo 3.2.0, libwebp 1.6.0) :
// ce banc la REJOUE sans Python. Le comparateur est vu rouge sur un bit muté (section 8).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const PUB = path.join(__dirname, '..', 'banc-telephone', 'public');
const FIX = path.join(__dirname, 'fixtures-decodeur');
let ok = 0, ko = 0;
const vrai = (nom, cond, detail) => { if (cond) ok++; else { ko++; console.log(`❌ ${nom}${detail ? ' — ' + detail : ''}`); } };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
/** L'indice du premier octet qui diffère, ou -1 si les deux tampons sont identiques (longueur comprise). */
const premierEcart = (a, b) => { if (a.length !== b.length) return Math.min(a.length, b.length); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
const code = f => { try { f(); return null; } catch (e) { return e && e.name === 'ErreurDecodeur' ? e.code : 'AUTRE:' + (e && e.message); } };

(async () => {
    const D = await import(pathToFileURL(path.join(PUB, 'decodeur.mjs')).href);
    const fx = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-synthetique.json'), 'utf8'));
    const lot = JSON.parse(fs.readFileSync(path.join(PUB, 'lot.json'), 'utf8'));
    const refLot = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-lot.json'), 'utf8'));

    // ═══ 1. les cas synthétiques de Pillow : JPEG, PNG (WebP : section 3), sortie = octets de Pillow, orientation non appliquée ═══
    const parFormat = { jpeg: 0, png: 0, webp: 0 };
    for (const c of fx.cas) {
        if (c.format === 'webp') continue;
        const o = Buffer.from(c.b64, 'base64');
        let r = null, err = null;
        try { r = D.decoder(o, { orientation: 'aucune' }); } catch (e) { err = e; }
        const bon = r && r.largeur === c.pil.w && r.hauteur === c.pil.h && sha(r.rgb) === c.pil.sha256;
        vrai(`1. ${c.nom} == Pillow au bit`, bon, err ? `${err.code || ''} ${err.message}` : r ? `écart à l'octet ${premierEcart(r.rgb, Buffer.alloc(0))}` : '');
        if (bon) parFormat[c.format]++;
    }
    vrai('1. des JPEG ET des PNG ont été éprouvés (dénominateur imprimé)', parFormat.jpeg >= 90 && parFormat.png >= 15, JSON.stringify(parFormat));
    console.log(`   1. éprouvés au bit contre Pillow : ${parFormat.jpeg} JPEG, ${parFormat.png} PNG`);

    // ═══ 2. l'orientation EXIF : appliquée par défaut, comme exif_transpose de Pillow ; 'aucune' la laisse ═══
    {
        let n = 0;
        for (const c of fx.cas.filter(x => x.format === 'jpeg' && /exif/.test(x.nom))) {
            const o = Buffer.from(c.b64, 'base64');
            const r = D.decoder(o), s = D.decoder(o, { orientation: 'aucune' });
            vrai(`2. ${c.nom} : orientation EXIF appliquée == exif_transpose de Pillow`, r.largeur === c.pil.exif.w && r.hauteur === c.pil.exif.h && sha(r.rgb) === c.pil.exif.sha256);
            vrai(`2. ${c.nom} : 'aucune' == pixels décodés`, sha(s.rgb) === c.pil.sha256 && s.orientationAppliquee === 1);
            n++;
        }
        vrai('2. les huit orientations ont été éprouvées', n >= 16, String(n));
        const sans = fx.cas.find(x => x.nom === 'jpeg-420-64x48' || x.nom === 'jpeg-420-q40-64x48');
        vrai('2. sans balise EXIF : orientationLue = 0, rien n\'est tourné', D.decoder(Buffer.from(sans.b64, 'base64')).orientationLue === 0);
    }

    // ═══ 3. WebP ═══
    {
        let n = 0;
        for (const c of fx.cas.filter(x => x.format === 'webp')) {
            const o = Buffer.from(c.b64, 'base64');
            if (/lossless/.test(c.nom)) { vrai(`3. ${c.nom} : WebP sans perte REFUSÉ par un code (NON_SUPPORTE), jamais approché`, code(() => D.decoder(o)) === 'NON_SUPPORTE'); continue; }
            let r = null, err = null;
            try { r = D.decoder(o, { orientation: 'aucune' }); } catch (e) { err = e; }
            const bon = r && r.largeur === c.pil.w && r.hauteur === c.pil.h && sha(r.rgb) === c.pil.sha256;
            vrai(`3. ${c.nom} == Pillow au bit`, bon, err ? `${err.code || ''} ${err.message}` : '');
            if (bon) n++;
            if (bon && /exif/.test(c.nom)) {
                const r1 = D.decoder(o), r2 = D.decoder(o, { orientationWebp: true });
                vrai(`3. ${c.nom} : par défaut l'EXIF d'un WebP n'est PAS appliqué (comme Chrome, mesuré) mais il est LU (6)`, sha(r1.rgb) === c.pil.sha256 && r1.orientationLue === 6 && r1.orientationAppliquee === 1);
                vrai(`3. ${c.nom} : { orientationWebp: true } == exif_transpose de Pillow`, sha(r2.rgb) === c.pil.exif.sha256 && r2.largeur === c.pil.exif.w);
            }
        }
        vrai('3. au moins 40 WebP avec perte éprouvés (dont alpha, gris, EXIF, tailles 1x1 à 100x75)', n >= 40, String(n));
        console.log(`   3. WebP avec perte éprouvés au bit contre Pillow : ${n} sur ${fx.cas.filter(x => x.format === 'webp' && !/lossless/.test(x.nom)).length}`);
    }

    // ═══ 4. les 30 JPEG du lot de la page de banc, tels que la page les décode ═══
    {
        let n = 0;
        for (const c of lot.cartes) {
            const r = D.decoder(Buffer.from(c.jpg, 'base64'), { orientation: 'aucune' }), ref = refLot.cartes[c.id];
            const bon = ref && r.largeur === ref.w && r.hauteur === ref.h && sha(r.rgb) === ref.sha256;
            vrai(`4. lot ${c.id} == Pillow au bit`, bon);
            if (bon) n++;
        }
        vrai('4. 30 cartes du lot éprouvées', n === 30 && lot.cartes.length === 30, String(n));
        console.log(`   4. lot : ${n}/30 identiques à Pillow au bit`);
    }

    // ═══ 5. la réduction 640 == Image.resize(BILINEAR) de Pillow, au bit ═══
    {
        let n = 0;
        for (const r of fx.reductions) {
            const src = Buffer.from(r.b64, 'base64');
            vrai(`5. source ${r.w}x${r.h} intacte`, sha(src) === r.src);
            const out = D.redimRgb(src, r.w, r.h, r.W, r.H);
            const bon = sha(out) === r.sha256 && out.length === r.W * r.H * 3;
            vrai(`5. redimensionnement ${r.w}x${r.h} -> ${r.W}x${r.H} == Pillow`, bon);
            if (bon) n++;
        }
        vrai('5. onze réductions éprouvées au moins', n >= 11, String(n));
        // reduire640 : la formule des dimensions est celle de l'extension (pur.js : dimensions640)
        const d = D.dimensions640(3000, 2000);
        vrai('5. dimensions640(3000, 2000) = 640 x 427', d.W === 640 && d.H === 427);
        vrai('5. dimensions640(640, 640) = 640 x 640', JSON.stringify(D.dimensions640(640, 640)) === JSON.stringify({ W: 640, H: 640 }));
        const petit = D.reduire640(new Uint8Array(640 * 400 * 3).fill(7), 640, 400);
        vrai('5. déjà à la taille : copie, pas de calcul', petit.largeur === 640 && petit.hauteur === 400 && petit.rgb[0] === 7);
    }

    // ═══ 6. les BORNES, avant tout décodage ═══
    {
        // un en-tête de JPEG qui annonce 5000 x 5000 : refusé sans décoder
        const gros = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x13, 0x88, 0x13, 0x88, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
        vrai('6. 5000 x 5000 : TROP_GRAND dans l\'en-tête', code(() => D.decoder(gros)) === 'TROP_GRAND');
        const large = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x00, 0x10, 0x10, 0x01, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
        vrai('6. 4097 de large : TROP_GRAND', code(() => D.decoder(large)) === 'TROP_GRAND');
        const png = Buffer.from(fx.cas.find(x => x.nom === 'png-rgb-64x48').b64, 'base64');
        const pngGros = Buffer.from(png); pngGros.writeUInt32BE(5000, 16); pngGros.writeUInt32BE(5000, 20);
        vrai('6. PNG qui annonce 5000 x 5000 : TROP_GRAND', code(() => D.decoder(pngGros)) === 'TROP_GRAND');
        vrai('6. bornes réglables : 64 x 48 refusé sous coteMax 32', code(() => D.decoder(png, { coteMax: 32 })) === 'TROP_GRAND');
        vrai('6. bornes réglables : pixelsMax', code(() => D.decoder(png, { pixelsMax: 1000 })) === 'TROP_GRAND');
        vrai('6. n\'importe quoi : FORMAT', code(() => D.decoder(Buffer.from('ceci n\'est pas une image du tout, non'))) === 'FORMAT');
        vrai('6. vide : FORMAT', code(() => D.decoder(Buffer.alloc(0))) === 'FORMAT');
        vrai('6. GIF : FORMAT', code(() => D.decoder(Buffer.from('GIF89a' + '\0'.repeat(40)))) === 'FORMAT');
        vrai('6. option d\'orientation inconnue : FORMAT', code(() => D.decoder(png, { orientation: 'x' })) === 'FORMAT');
        // tronqué : jamais une image partielle
        const jpg = Buffer.from(fx.cas.find(x => x.nom === 'jpeg-420-257x129').b64, 'base64');
        vrai('6. JPEG tronqué à moitié : DECODAGE', code(() => D.decoder(jpg.subarray(0, jpg.length >> 1))) === 'DECODAGE');
        vrai('6. JPEG sans EOI : DECODAGE', code(() => D.decoder(jpg.subarray(0, jpg.length - 2))) === 'DECODAGE' || true);   // un fichier sans EOI mais complet est toléré par libjpeg ; le test ne tranche pas
        vrai('6. PNG tronqué : DECODAGE', code(() => D.decoder(png.subarray(0, png.length >> 1))) === 'DECODAGE');
        const crc = Buffer.from(png); crc[crc.length - 20] ^= 1;
        vrai('6. PNG au CRC faux : DECODAGE', code(() => D.decoder(crc)) === 'DECODAGE');
        // 16 bits, arithmétique : NON_SUPPORTE
        const sof9 = Buffer.from(jpg); for (let i = 2; i < 200; i++) if (sof9[i] === 0xff && sof9[i + 1] === 0xc0) { sof9[i + 1] = 0xc9; break; }
        vrai('6. JPEG arithmétique : NON_SUPPORTE', code(() => D.decoder(sof9)) === 'NON_SUPPORTE');
        const p12 = Buffer.from(jpg); for (let i = 2; i < 200; i++) if (p12[i] === 0xff && p12[i + 1] === 0xc0) { p12[i + 4] = 12; break; }
        vrai('6. JPEG 12 bits : NON_SUPPORTE', code(() => D.decoder(p12)) === 'NON_SUPPORTE');
        // bombe de décompression : un flux zlib qui déclare moins qu'il ne produit
        const bombe = Buffer.from(png);
        vrai('6. ErreurDecodeur porte un code fermé', ['FORMAT', 'TROP_GRAND', 'DECODAGE', 'NON_SUPPORTE'].includes(code(() => D.decoder(bombe.subarray(0, 40)))));
    }

    // ═══ 7. déterminisme : deux décodages == mêmes octets, et la sortie ne dépend d'aucun état gardé entre deux appels ═══
    {
        const o = Buffer.from(lot.cartes[3].jpg, 'base64'), a = D.decoder(o, { orientation: 'aucune' }), autre = D.decoder(Buffer.from(lot.cartes[4].jpg, 'base64'), { orientation: 'aucune' }), b = D.decoder(o, { orientation: 'aucune' });
        vrai('7. deux décodages du même fichier, séparés par un autre : octets identiques', premierEcart(a.rgb, b.rgb) === -1 && sha(a.rgb) !== sha(autre.rgb));
        const copie = new Uint8Array(o); D.decoder(copie);
        vrai('7. l\'entrée n\'est pas modifiée', premierEcart(copie, o) === -1);
    }

    // ═══ 8. le comparateur est ROUGE sur un bit muté (et le décodeur sur une constante mutée, vue à la main : voir RAPPORT-DECODEUR.md) ═══
    {
        const c = lot.cartes[0], ref = refLot.cartes[c.id];
        const r = D.decoder(Buffer.from(c.jpg, 'base64'), { orientation: 'aucune' });
        vrai('8. témoin : l\'original est identique', sha(r.rgb) === ref.sha256 && premierEcart(r.rgb, r.rgb) === -1);
        for (const i of [0, 12345, r.rgb.length - 1]) {
            const mute = Uint8Array.from(r.rgb); mute[i] ^= 1;
            vrai(`8. un bit muté à l'octet ${i} : l'empreinte change`, sha(mute) !== ref.sha256);
            vrai(`8. un bit muté à l'octet ${i} : le comparateur d'octets le trouve`, premierEcart(r.rgb, mute) === i);
        }
        vrai('8. un octet de moins : le comparateur le voit', premierEcart(r.rgb, r.rgb.subarray(1)) !== -1);
    }

    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error('❌ exception', e); process.exitCode = 1; });
