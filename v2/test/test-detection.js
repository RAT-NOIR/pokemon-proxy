'use strict';
// DETECTION DETERMINISTE (v2/banc-telephone/public/detection.mjs) — node pur, sans base ni reseau.
//  1. SHA-256 ecrit a la main == crypto ; 2. fma32 == la multiplication-addition fusionnee EXACTE (BigInt), dont le piege du double arrondi ;
//  3. la reduction == les octets de Chrome 157 (fixture doree fabriquee par outils/detection/pages/golden.mjs : SHA-256 de ce que le canvas « high » rend pour des sources synthetiques) ;
//  4. le domaine, l'identite a facteur 1, la voie ; 5. la chaine complete (decoder -> reduire -> OpenCV.js de l'extension -> redresser) rejouee sur le lot de la page : memes quadrilateres et memes empreintes que les ATTENDUS.
// RM_DETECTION_PUB : rejouer le banc contre une AUTRE version des modules (c'est ainsi que outils/detection/mutations.mjs prouve que le banc sait dire non).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const PUB = process.env.RM_DETECTION_PUB || path.join(__dirname, '..', 'banc-telephone', 'public');
let ok = 0, ko = 0;
const vrai = (nom, cond, detail) => { if (cond) ok++; else { ko++; console.log(`❌ ${nom}${detail ? ' — ' + detail : ''}`); } };

// l'arithmetique exacte : fma(a, b, c) arrondi UNE fois au float32 le plus proche (pair a egalite), en BigInt
const f32bits = (x) => { const v = new DataView(new ArrayBuffer(4)); v.setFloat32(0, x); return v.getUint32(0); };
function decomposer(x) { // x float32 fini -> { s, m (BigInt), e } avec |x| = m * 2^e
    const b = f32bits(x), s = b >>> 31 ? -1n : 1n, ex = (b >>> 23) & 255, mant = b & 0x7fffff;
    return ex === 0 ? { s, m: BigInt(mant), e: -149 } : { s, m: BigInt(mant | 0x800000), e: ex - 150 };
}
function fmaExact(a, b, c) {
    const A = decomposer(a), B = decomposer(b), C = decomposer(c);
    const e = Math.min(A.e + B.e, C.e);
    let N = A.s * B.s * A.m * B.m * (1n << BigInt(A.e + B.e - e)) + C.s * C.m * (1n << BigInt(C.e - e));
    if (N === 0n) return 0;
    const neg = N < 0n; if (neg) N = -N;
    const bits = N.toString(2).length, sh = bits - 24;
    let q = N, ee = e;
    if (sh > 0) {
        q = N >> BigInt(sh); const rem = N & ((1n << BigInt(sh)) - 1n), moitie = 1n << BigInt(sh - 1);
        if (rem > moitie || (rem === moitie && (q & 1n))) q += 1n;
        ee = e + sh;
    }
    const v = Number(q) * Math.pow(2, ee);
    return neg ? -v : v;
}
const aleaGraine = (s) => () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

(async () => {
    const D = await import(pathToFileURL(path.join(PUB, 'detection.mjs')).href);
    const f32 = Math.fround;

    // ═══ 1. SHA-256 ═══
    {
        const r = aleaGraine(7); let bons = 0, n = 0;
        for (const taille of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 4096, 100003]) {
            const o = new Uint8Array(taille); for (let i = 0; i < taille; i++) o[i] = Math.floor(r() * 256);
            n++; if (D.sha256(o) === crypto.createHash('sha256').update(o).digest('hex')) bons++;
        }
        vrai('1. sha256 identique a crypto sur 15 tailles (blocs limites 55/56/63/64/119/120 compris)', bons === n, `${bons}/${n}`);
    }

    // ═══ 2. fma32 exact ═══
    {
        const u = Math.pow(2, -12), a = f32(1 + u);
        // le piege : a*a = 1 + 2^-11 + 2^-24 est EXACTEMENT au milieu de deux float32 ; la somme double arrondit c = 2^-60 en perdant ; fround seul arrondit au pair (vers le bas)
        const naif = (x, y, z) => f32(x * y + z);
        const c = f32(Math.pow(2, -60));
        vrai('2. le piege du double arrondi existe : fround(a*b+c) se trompe sur le cas fabrique', naif(a, a, c) !== fmaExact(a, a, c));
        vrai('2. fma32 : cas fabrique, c > 0 -> arrondi vers le haut', D.fma32(a, a, c) === fmaExact(a, a, c) && D.fma32(a, a, c) === f32(1 + Math.pow(2, -11) + Math.pow(2, -23)), String(D.fma32(a, a, c)));
        vrai('2. fma32 : cas fabrique, c < 0 -> arrondi vers le bas', D.fma32(a, a, -c) === fmaExact(a, a, -c) && D.fma32(a, a, -c) === f32(1 + Math.pow(2, -11)));
        vrai('2. fma32 : milieu exact (c = 0) -> pair, comme le materiel', D.fma32(a, a, 0) === fmaExact(a, a, 0));
        const r = aleaGraine(11); let diffs = 0, essais = 0, pieges = 0;
        const aleaF32 = (emin, emax) => f32((r() < 0.5 ? -1 : 1) * (1 + r()) * Math.pow(2, Math.floor(emin + r() * (emax - emin))));
        for (let i = 0; i < 60000; i++) {
            const x = i % 3 === 0 ? f32(r()) : aleaF32(-8, 8), y = i % 3 === 0 ? f32(r()) : aleaF32(-8, 8), z = i % 2 ? aleaF32(-70, 8) : f32(r());
            essais++; if (D.fma32(x, y, z) !== fmaExact(x, y, z)) diffs++;
            if (naif(x, y, z) !== fmaExact(x, y, z)) pieges++;
        }
        vrai('2. fma32 == fma exact sur 60 000 triplets aleatoires (exposants espaces, sommes a poids faibles)', diffs === 0, `${diffs}/${essais} ecarts`);
        // poids reels de la reduction : (1 - fx) * fy etc. fois des niveaux /255
        let d2 = 0, n2 = 0; const L = (s) => f32(s * f32(1 / 255));
        for (let i = 0; i < 60000; i++) { const w = f32(Math.floor(r() * 64) / 64 * (r() < 0.2 ? r() : 1)), s = L(Math.floor(r() * 256)), acc = f32(r()); n2++; if (D.fma32(w, s, acc) !== fmaExact(w, s, acc)) d2++; }
        vrai('2. fma32 == fma exact sur 60 000 triplets de la forme reelle (poids x niveau/255 + cumul)', d2 === 0, `${d2}/${n2}`);
    }

    // ═══ 3. la reduction == Chrome ═══
    {
        const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-detection', 'chrome-high.json'), 'utf8'));
        let bons = 0;
        for (const c of fx.cas) {
            const src = D.sourceSynthetique(c.graine, c.w, c.h);
            const out = D.bilineaire32(src, c.w, c.h, c.W, c.H);
            const bon = D.sha256(out) === c.sha256; if (bon) bons++;
            vrai(`3. ${c.w}x${c.h} -> ${c.W}x${c.H} (graine ${c.graine}) == Chrome « high » au bit`, bon);
        }
        vrai('3. la fixture porte des cas (denominateur imprime) et vient bien de Chrome', fx.cas.length >= 20 && /Chrome\/\d+/.test(fx.ua), `${fx.cas.length} cas, ${fx.ua}`);
        console.log(`   3. reduction identique a Chrome : ${bons}/${fx.cas.length} cas (${fx.ua.match(/Chrome\/[\d.]+/)})`);
    }

    // ═══ 4. domaine, facteur 1, voie ═══
    {
        vrai('4. domaine : 800 -> 640 (facteur 1,25) dedans', D.dansLeDomaineCanvas(800, 600, 640, 480));
        vrai('4. domaine : facteur 1 dedans', D.dansLeDomaineCanvas(640, 480, 640, 480));
        vrai('4. domaine : 1 000 -> 640 (1,5625) dehors', !D.dansLeDomaineCanvas(1000, 750, 640, 480));
        vrai('4. domaine : agrandissement dehors', !D.dansLeDomaineCanvas(600, 600, 640, 640));
        const src = D.sourceSynthetique(5, 640, 480);
        const id = D.bilineaire32(src, 640, 480, 640, 480);
        vrai('4. facteur 1 : la reduction est l\'identite (aucun octet change)', Buffer.compare(Buffer.from(id), Buffer.from(src)) === 0);
        const a = D.reduire(D.sourceSynthetique(6, 800, 600), 800, 600), b = D.reduire(D.sourceSynthetique(6, 1000, 750), 1000, 750), c = D.reduire(D.sourceSynthetique(6, 600, 600), 600, 600), p = D.reduire(D.sourceSynthetique(6, 800, 600), 800, 600, { voie: 'pillow' });
        vrai('4. voie : 800x600 -> canvas-high ; 1000x750 -> pillow ; 600x600 (agrandissement) -> pillow ; voie forcee -> pillow', [a.voie, b.voie, c.voie, p.voie].join() === 'canvas-high,pillow,pillow,pillow', [a.voie, b.voie, c.voie, p.voie].join());
        vrai('4. dimensions 640 : 800x600 -> 640x480', a.largeur === 640 && a.hauteur === 480);
    }

    // ═══ 5. la chaine complete sur le lot de la page ═══
    {
        const fLot = path.join(PUB, 'lot-detection.json');
        if (!fs.existsSync(fLot)) { vrai('5. lot-detection.json present', false, fLot); }
        else {
            const lot = JSON.parse(fs.readFileSync(fLot, 'utf8'));
            globalThis.Module = { wasmBinary: fs.readFileSync(path.join(PUB, 'opencv', 'opencv_js.wasm')) };
            const cv = await require(path.join(PUB, 'opencv', 'opencv.js'));
            let bons = 0; const voies = {};
            for (const im of lot.images) {
                const octets = new Uint8Array(Buffer.from(im.b64, 'base64'));
                vrai(`5. ${im.id} : les octets du lot ont le sha256 annonce`, crypto.createHash('sha256').update(octets).digest('hex') === im.sha256);
                const r = D.detecter(cv, octets);
                const att = im.attendu;
                const bon = r.empreintes.rgb640 === att.empreintes.rgb640 && r.empreintes.quads === att.empreintes.quads && r.empreintes.carte === att.empreintes.carte && JSON.stringify(r.quad) === JSON.stringify(att.quad) && r.nCartes === att.nCartes && r.voie === att.voie && JSON.stringify(r.dim640) === JSON.stringify(att.dim640);
                voies[r.voie] = (voies[r.voie] || 0) + 1;
                vrai(`5. ${im.id} (${im.format} ${im.largeur}x${im.hauteur}) : 640, quadrilateres, carte == attendus`, bon);
                if (bon) bons++;
            }
            vrai('5. le lot a des cartes redressees ET passe par les deux voies de reduction', lot.images.filter((i) => i.attendu.redressee).length >= 8 && voies['canvas-high'] >= 4 && voies.pillow >= 2, JSON.stringify(voies));
            console.log(`   5. chaine complete == attendus : ${bons}/${lot.images.length} images ; voies ${JSON.stringify(voies)}`);
        }
    }
    // ═══ 6. le seul ecart voulu (Math.sqrt au lieu de Math.hypot) et les deux seuils (15 % du rapport de carte, 3 % de la diagonale) ═══
    {
        // des couples ou Math.hypot de CE moteur differe de la racine de la somme des carres : le test n'a de sens que s'il en existe (sinon une mutation vers hypot passerait)
        const couples = []; for (let dx = 1; dx < 60 && couples.length < 6; dx++) for (let dy = 1; dy < 60 && couples.length < 6; dy++) if (Math.hypot(dx, dy) !== Math.sqrt(dx * dx + dy * dy)) couples.push([dx, dy]);
        vrai('6. dans ce moteur, Math.hypot differe de la racine pour des couples d\'entiers (le test est discriminant)', couples.length >= 3, `${couples.length} couples`);
        vrai('6. dist == racine de dx*dx + dy*dy, et PAS Math.hypot, sur ces couples', couples.every(([dx, dy]) => D.dist({ x: 0, y: 0 }, { x: dx, y: dy }) === Math.sqrt(dx * dx + dy * dy) && D.dist({ x: 0, y: 0 }, { x: dx, y: dy }) !== Math.hypot(dx, dy)));
        vrai('6. diagonale == racine de W*W + H*H, et PAS Math.hypot, sur ces couples', couples.every(([W, H]) => D.diagonale(W, H) === Math.sqrt(W * W + H * H) && D.diagonale(W, H) !== Math.hypot(W, H)));
        // le rapport de carte : 63/88 a 15 % pres, des deux cotes (un rectangle de cote 1000 et de rapport donne)
        const RATIO = 63 / 88, rect = (r) => [{ x: 0, y: 0 }, { x: 1000 * r, y: 0 }, { x: 1000 * r, y: 1000 }, { x: 0, y: 1000 }];
        for (const [nom, k, accepte] of [['14,9 % sous', 1 - 0.149, true], ['15,1 % sous', 1 - 0.151, false], ['14,9 % au-dessus', 1 + 0.149, true], ['15,1 % au-dessus', 1 + 0.151, false], ['exact', 1, true]])
            vrai(`6. rapport de carte ${nom} ⇒ ${accepte ? 'accepte' : 'refuse'}`, (D.evaluerQuadrilatere(rect(RATIO * k), 2000, 2000) !== null) === accepte);
        vrai('6. un rectangle paysage (rapport inverse) est accepte et marque paysage', (() => { const c = D.evaluerQuadrilatere([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 * RATIO }, { x: 0, y: 1000 * RATIO }], 2000, 2000); return c !== null && c.paysage === true; })());
        // les quasi-doublons : 4 coins a moins de 3 % de la diagonale ; et l'aire maximale 0,985
        const W = 300, H = 400, diag = D.diagonale(W, H);   // 500
        const quad = (dx) => [{ x: 10 + dx, y: 10 }, { x: 200 + dx, y: 10 }, { x: 200 + dx, y: 290 }, { x: 10 + dx, y: 290 }];
        const cand = (dx, aire) => ({ quad: quad(dx), aire, paysage: false });
        vrai('6. quasi-doublon a 2,9 % de la diagonale : le second est ecarte', D.retenirCandidats([cand(0, 0.5), cand(0.029 * diag, 0.4)], W, H).length === 1);
        vrai('6. a 3,1 % de la diagonale : les deux sont gardes', D.retenirCandidats([cand(0, 0.5), cand(0.031 * diag, 0.4)], W, H).length === 2);
        vrai('6. la diagonale est celle de l\'image (3,1 % de 500 est ecarte sur une image dix fois plus grande : seuil 150)', D.retenirCandidats([cand(0, 0.5), cand(0.031 * diag, 0.4)], 3000, 4000).length === 1);
        vrai('6. aire 0,986 ecartee, 0,984 gardee ; le plus grand d\'abord', (() => { const a = D.retenirCandidats([cand(0, 0.986)], W, H), b = D.retenirCandidats([cand(0, 0.4), cand(100, 0.984)], W, H); return a.length === 0 && b.length === 2 && b[0].aire === 0.984; })());
    }
    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exit(ko ? 1 : 0);
})();
