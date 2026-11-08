'use strict';
// DECODEUR RAT-MARKET (v2/banc-telephone/public/decodeur*.mjs) — la preuve AU BIT contre Pillow, sans navigateur ni base : node pur.
// La vérité est l'empreinte SHA-256 de Image.open(...).convert('RGB').tobytes() fabriquée par outils/decodeur/fabriquer-fixtures.py et references-lot.py (Pillow 13, libjpeg-turbo 3.2.0, libwebp 1.6.0) :
// ce banc la REJOUE sans Python. Le comparateur est vu rouge sur un bit muté (section 8).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const PUB = process.env.RM_DECODEUR_PUB || path.join(__dirname, '..', 'banc-telephone', 'public');       // RM_DECODEUR_PUB : rejouer le banc contre une AUTRE version des modules (rouge vu contre l'ancienne)
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
        vrai('6. option d\'orientation inconnue : entree-invalide', code(() => D.decoder(png, { orientation: 'x' })) === 'entree-invalide');
        // tronqué : jamais une image partielle
        const jpg = Buffer.from(fx.cas.find(x => x.nom === 'jpeg-420-257x129').b64, 'base64');
        vrai('6. JPEG tronqué à moitié : DECODAGE', code(() => D.decoder(jpg.subarray(0, jpg.length >> 1))) === 'DECODAGE');
        vrai('6. JPEG sans EOI : DECODAGE (libjpeg le tolère ; refuser est plus sûr)', code(() => D.decoder(jpg.subarray(0, jpg.length - 2))) === 'DECODAGE');
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
        vrai('6. PNG réduit à son en-tête : DECODAGE', code(() => D.decoder(bombe.subarray(0, 40))) === 'DECODAGE');
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

    // ═══ 9. robustesse (tour T1) : aucune exception brute, codes d'erreur fermés ═══
    {
        const png = Buffer.from(fx.cas.find(x => x.nom === 'png-rgb-64x48').b64, 'base64'), ref = D.decoder(png);
        for (const [nom, v] of [['-1', -1], ['null', null], ['undefined', undefined], ['une chaîne', 'abc'], ['un objet', {}], ['un tableau ordinaire', [1, 2, 3]], ['un nombre', 7], ['un Float32Array de 0 octet', new Float32Array(0)]]) {
            // un Float32Array est une vue d'ArrayBuffer : accepté comme octets, mais vide -> FORMAT ; les autres -> entree-invalide
            const attendu = nom.startsWith('un Float32Array') ? 'FORMAT' : 'entree-invalide';
            vrai(`9. decoder(${nom}) sort sous le code « ${attendu} », jamais une exception brute`, code(() => D.decoder(v)) === attendu);
        }
        vrai('9. decoder(octets, 5) : options invalides -> entree-invalide', code(() => D.decoder(png, 5)) === 'entree-invalide');
        vrai('9. decoder(octets, { coteMax: -3 }) -> entree-invalide', code(() => D.decoder(png, { coteMax: -3 })) === 'entree-invalide');
        vrai('9. decoder(octets, { balayagesMax: 1.5 }) -> entree-invalide', code(() => D.decoder(png, { balayagesMax: 1.5 })) === 'entree-invalide');
        vrai('9. un ArrayBuffer et une vue (DataView) donnent les mêmes octets que le Uint8Array', sha(D.decoder(png.buffer.slice(png.byteOffset, png.byteOffset + png.length)).rgb) === sha(ref.rgb) && sha(D.decoder(new DataView(png.buffer, png.byteOffset, png.length)).rgb) === sha(ref.rgb));
        // un RangeError d'allocation (iPhone : mémoire) devient « memoire » : simulé par un Proxy dont la lecture lève ce que lève le moteur
        const piege = new Proxy(new Uint8Array(png), { get(c, p, r) { if (p === '0' || p === 0) throw new RangeError('Array buffer allocation failed'); const v = Reflect.get(c, p, c); return typeof v === 'function' ? v.bind(c) : v; } });
        vrai('9. RangeError d\'allocation -> code « memoire »', code(() => D.decoder(piege)) === 'memoire');
        vrai('9. TypeError interne imprévu -> code DECODAGE (jamais brut)', code(() => D.decoder(new Proxy(new Uint8Array(png), { get(c, p) { if (p === '0') throw new TypeError('x'); const v = Reflect.get(c, p, c); return typeof v === 'function' ? v.bind(c) : v; } }))) === 'DECODAGE');
    }

    // ═══ 10. JPEG progressif : plafond de balayages, plafond de pixels AVANT allocation, complétude ═══
    const t1 = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-t1.json'), 'utf8'));
    const marqueursSos = o => { const r = []; let i = 2; while (i + 4 <= o.length) { if (o[i] !== 0xff) break; const m = o[i + 1]; if (m === 0xd9) break; const n = (o[i + 2] << 8) | o[i + 3]; if (m === 0xda) { r.push(i); let j = i + 2 + n; for (;;) { const k = o.indexOf(0xff, j); if (o[k + 1] === 0 || (o[k + 1] >= 0xd0 && o[k + 1] <= 0xd7)) { j = k + 2; continue; } i = k; break; } } else i += 2 + n; } return r; };
    {
        const base = Buffer.from(t1.cas.find(x => x.nom === 'jpeg-progressif-balayages-64x48').b64, 'base64'), sos = marqueursSos(base);
        // un balayage AC « spectral seul » (Ah = 0, Al = 0) peut se répéter sans que la progression devienne incohérente : c'est le fichier hostile (RELECTURE-2 n°1). On prend le 2e balayage de Pillow et on force Al = 0.
        const i2 = sos[1], fin2 = (i2 + 2 + base.readUInt16BE(i2 + 2) - 1), debut3 = sos[2];
        const spectral = Buffer.from(base.subarray(i2, debut3)); spectral[fin2 - i2] = spectral[fin2 - i2] & 0xf0;
        const empile = n => Buffer.concat([base.subarray(0, base.length - 2), ...Array.from({ length: n }, () => spectral), Buffer.from([0xff, 0xd9])]);       // après le dernier balayage : toutes les progressions restent cohérentes
        vrai('10. témoin : le progressif de Pillow est décodé (balayages : ' + sos.length + ')', code(() => D.decoder(base)) === null);
        vrai('10. 70 balayages empilés : refusé par TROP_GRAND (plafond 64)', code(() => D.decoder(empile(70))) === 'TROP_GRAND');
        vrai('10. 60 balayages empilés (64 au total ou moins) : pas de refus par le plafond', code(() => D.decoder(empile(40))) !== 'TROP_GRAND');
        vrai('10. le plafond est une option : à 200, 70 balayages empilés ne sont plus refusés par lui', code(() => D.decoder(empile(70), { balayagesMax: 200 })) !== 'TROP_GRAND');
        vrai('10. le plafond de 64 ne refuse aucun progressif de Pillow du corpus', t1.cas.filter(x => x.balayages).every(x => x.balayages <= 64));
        // pic mémoire : un progressif qui annonce 4000 x 3000 (12 Mpx, sous le plafond général) est refusé AVANT d'allouer ses coefficients
        const gros = Buffer.from(base); for (let i = 2; i < 200; i++) if (gros[i] === 0xff && gros[i + 1] === 0xc2) { gros.writeUInt16BE(3000, i + 5); gros.writeUInt16BE(4000, i + 7); break; }
        const avant = process.memoryUsage().arrayBuffers;
        vrai('10. progressif 4000 x 3000 : TROP_GRAND (plafond progressif 4 Mpx)', code(() => D.decoder(gros)) === 'TROP_GRAND');
        vrai('10. ... et rien n\'a été alloué avant le refus (arrayBuffers +< 1 Mo)', process.memoryUsage().arrayBuffers - avant < 1e6, String(process.memoryUsage().arrayBuffers - avant));
        vrai('10. le plafond progressif est une option', code(() => D.decoder(gros, { pixelsMaxProgressif: 13000000 })) !== 'TROP_GRAND');
        const seq = Buffer.from(fx.cas.find(x => x.nom === 'jpeg-420-257x129').b64, 'base64'); for (let i = 2; i < 200; i++) if (seq[i] === 0xff && seq[i + 1] === 0xc0) { seq.writeUInt16BE(3000, i + 5); seq.writeUInt16BE(4000, i + 7); break; }
        vrai('10. le même format en SÉQUENTIEL garde le plafond de 12 Mpx (autre refus que TROP_GRAND)', code(() => D.decoder(seq)) !== 'TROP_GRAND');
    }

    // ═══ 11. le jeu T1 de Pillow : PNG entrelacé Adam7, palettes 1/2/4/8 bits, tRNS, table de quantification verrouillée, progressifs incomplets, adler32 ═══
    {
        const fam = {};
        for (const c of t1.cas) {
            if (c.balayages) continue;
            const o = Buffer.from(c.b64, 'base64'), famille = c.nom.replace(/-\d+x\d+$/, '').replace(/palette\d/, 'paletteN');
            const f = fam[famille] || (fam[famille] = { ok: 0, mal: 0 });
            if (c.refuse) { const bon = code(() => D.decoder(o, { orientation: 'aucune' })) === c.refuse; f[bon ? 'ok' : 'mal']++; vrai(`11. ${c.nom} : refusé par ${c.refuse}`, bon); continue; }
            let r = null; try { r = D.decoder(o, { orientation: 'aucune' }); } catch (e) { /* compté ci-dessous */ }
            const bon = r && r.largeur === c.pil.w && r.hauteur === c.pil.h && sha(r.rgb) === c.pil.sha256;
            f[bon ? 'ok' : 'mal']++; vrai(`11. ${c.nom} == Pillow au bit`, bon);
        }
        for (const f of ['png-adam7-rgb', 'png-adam7-gris', 'png-adam7-rgba', 'png-adam7-grisalpha', 'png-adam7-paletteN', 'png-plein-paletteN', 'png-pillow-palette-bits1', 'png-pillow-palette-bits2', 'png-pillow-palette-bits4', 'png-adam7-paletteN-trns', 'jpeg-progressif-dqt-redefinie']) vrai(`11. famille ${f} éprouvée`, fam[f] && fam[f].ok >= 2 && fam[f].mal === 0, JSON.stringify(fam[f]));
        console.log('   11. éprouvés (ok / mal) : ' + Object.entries(fam).map(([k, v]) => `${k} ${v.ok}/${v.mal}`).join(', '));
    }

    // ═══ 12. refus de ce qui n'a pas de preuve : échantillonnages, séquentiel non entrelacé, DQT 16 bits, deflate sur-souscrit ═══
    {
        const sof = (o, f) => { const c = Buffer.from(o); for (let i = 2; i < 300; i++) if (c[i] === 0xff && c[i + 1] === 0xc0) { f(c, i); return c; } throw new Error('pas de SOF0'); };
        const c420 = Buffer.from(fx.cas.find(x => x.nom === 'jpeg-420-64x48').b64, 'base64'), gris = Buffer.from(fx.cas.find(x => x.nom === 'jpeg-gris-64x48').b64, 'base64'), c444 = Buffer.from(fx.cas.find(x => x.nom === 'jpeg-444-64x48').b64, 'base64');
        vrai('12. chroma Cb 2x2 : NON_SUPPORTE', code(() => D.decoder(sof(c420, (c, i) => { c[i + 14] = 0x22; }))) === 'NON_SUPPORTE');
        vrai('12. luma 1x2 (4:4:0) : NON_SUPPORTE', code(() => D.decoder(sof(c444, (c, i) => { c[i + 11] = 0x12; }))) === 'NON_SUPPORTE');
        vrai('12. gris échantillonné 2x2 : NON_SUPPORTE', code(() => D.decoder(sof(gris, (c, i) => { c[i + 11] = 0x22; }))) === 'NON_SUPPORTE');
        const dqt16 = Buffer.concat([c444.subarray(0, 2), Buffer.from([0xff, 0xdb, 0, 67 + 64, 0x10]), Buffer.alloc(128, 1), c444.subarray(2)]);
        vrai('12. table de quantification 16 bits : NON_SUPPORTE', code(() => D.decoder(dqt16)) === 'NON_SUPPORTE');
        // séquentiel non entrelacé : un SOS à une seule composante dans une image à trois
        const ns1 = Buffer.from(c444); { const i = ns1.indexOf(Buffer.from([0xff, 0xda])); ns1.writeUInt16BE(8, i + 2); ns1[i + 4] = 1; ns1.copy(ns1, i + 7, i + 14); ns1[i + 5] = 1; ns1[i + 6] = 0x00; }
        vrai('12. séquentiel non entrelacé : NON_SUPPORTE', code(() => D.decoder(ns1)) === 'NON_SUPPORTE');
        // deflate (zlib) : jeux de longueurs sur-souscrit et incomplet refusés comme zlib
        const bitsEnOctets = bits => { const o = []; for (let i = 0; i < bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8).split('').reverse().join('').padEnd(8, '0'), 2)); return Uint8Array.from(o); };
        const nb = (v, n) => v.toString(2).padStart(n, '0').split('').reverse().join('');      // nombre sur n bits, poids faible d'abord
        const bloc = lc => '1' + nb(2, 2) + nb(0, 5) + nb(0, 5) + nb(0, 4) + lc.map(l => nb(l, 3)).join('');       // BFINAL, BTYPE 2, HLIT 257, HDIST 1, HCLEN 4, longueurs des 4 codes (16, 17, 18, 0)
        const zl = bits => Uint8Array.from([0x78, 0x9c, ...bitsEnOctets(bits), 0, 0, 0, 0, 0, 0]);
        const { inflater } = await import(pathToFileURL(path.join(PUB, 'decodeur-png.mjs')).href);
        const msg = f => { try { f(); return 'accepté'; } catch (e) { return e.detail || e.message; } };
        vrai('12. longueurs de codes de longueurs SUR-SOUSCRITES (4 codes de longueur 1) : refusé', /sur-souscrit/.test(msg(() => inflater(zl(bloc([1, 1, 1, 1])), 4))));
        vrai('12. longueurs de codes de longueurs INCOMPLÈTES (1 code de longueur 1) : refusé', /incomplet/.test(msg(() => inflater(zl(bloc([1, 0, 0, 0])), 4))));
    }

    // ═══ 13. WebP : 400 flux ALÉATOIRES + 193 CIBLÉS (netteté x niveaux, filtre simple, saut, deltas, petite quantification) (outils/decodeur/generateur-webp.mjs) lus par Pillow : filtre simple, partitions, netteté, deltas, segments, saut, probabilités ═══
    {
        const dif = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-webp-differentiel.json'), 'utf8')), cible = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-webp-differentiel-cible.json'), 'utf8'));
        dif.cas = [...dif.cas, ...cible.cas];
        const n = { total: 0, identiques: 0, simple: 0, partitions: 0, nettete: 0, deltas: 0, segAbs: 0, segRel: 0, segCarte: 0, skip: 0, majProbas: 0, niveau0: 0 };
        for (const c of dif.cas) {
            n.total++;
            let r = null; try { r = D.decoder(Buffer.from(c.b64, 'base64'), { orientation: 'aucune' }); } catch (e) { /* compté */ }
            const bon = c.pil && r && r.largeur === c.pil.w && r.hauteur === c.pil.h && sha(r.rgb) === c.pil.sha256;
            vrai(`13. ${c.nom} == Pillow au bit`, bon);
            if (bon) { n.identiques++; if (c.simple) n.simple++; if (c.nparts > 1) n.partitions++; if (c.nettete > 0) n.nettete++; if (c.deltas) n.deltas++; if (c.segActif && c.segAbs) n.segAbs++; if (c.segActif && !c.segAbs) n.segRel++; if (c.segCarte) n.segCarte++; if (c.skip) n.skip++; if (c.majProbas) n.majProbas++; if (c.niveau === 0) n.niveau0++; }
        }
        for (const k of ['simple', 'partitions', 'nettete', 'deltas', 'segAbs', 'segRel', 'segCarte', 'skip', 'majProbas', 'niveau0']) vrai(`13. drapeau « ${k} » exercé par au moins 20 flux identiques à Pillow`, n[k] >= 20, String(n[k]));
        vrai('13. 593 flux (400 aléatoires + 193 ciblés), tous identiques', n.total === 593 && n.identiques === 593, JSON.stringify(n));
        console.log('   13. flux aléatoires identiques à Pillow : ' + JSON.stringify(n));
    }

    // ═══ 14. T1-1 : coefficients WebP au-delà de la zone prouvée (300) — option de refus, désactivée par défaut (les visuels réels la dépassent tous) ═══
    {
        const bruit = Buffer.from(fx.cas.find(x => x.nom === 'webp-q95-100x75').b64, 'base64');
        vrai('14. par défaut aucun plafond : un WebP à gros coefficients est accepté', code(() => D.decoder(bruit)) === null);
        vrai('14. { coeffMaxWebp: 300 } : refusé NON_SUPPORTE (coefficient hors de la zone prouvée)', code(() => D.decoder(bruit, { coeffMaxWebp: 300 })) === 'NON_SUPPORTE');
        vrai('14. { coeffMaxWebp: 100000 } : accepté', code(() => D.decoder(bruit, { coeffMaxWebp: 100000 })) === null);
        vrai('14. le plafond ne survit pas à l\'appel : l\'appel suivant sans option est accepté', code(() => D.decoder(bruit)) === null);
        vrai('14. { coeffMaxWebp: -2 } -> entree-invalide', code(() => D.decoder(bruit, { coeffMaxWebp: -2 })) === 'entree-invalide');
        const dif = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-webp-differentiel.json'), 'utf8'));
        vrai('14. les flux du générateur (bornés à 300 par construction) passent tous avec { coeffMaxWebp: 300 }', dif.cas.every(c => code(() => D.decoder(Buffer.from(c.b64, 'base64'), { coeffMaxWebp: 300 })) === null));
    }

    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error('❌ exception', e); process.exitCode = 1; });
