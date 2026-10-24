// node audit-catalogue/test-empreinte.js — l'empreinte du CENTRE de l'illustration (brief S8/AUDIT, mesure 5) : extraction de la fenêtre, distance, détection de l'image sans contraste.
// Images SYNTHÉTIQUES fabriquées ici (aucun fichier du testeur) : une « carte » 255×361 dont l'illustration est un motif déterministe, avec cadre, bandeau de titre et pied incrustés.
const sharp = require('sharp');
const E = require('./empreinte');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const vrai = (nom, cond, detail = '') => verifier(nom + (detail ? ` [${detail}]` : ''), Boolean(cond), true);

// un générateur déterministe (pas de Math.random : le banc doit rendre le même verdict à chaque lancement)
const alea = graine => () => { graine = (graine * 1664525 + 1013904223) >>> 0; return graine / 4294967296; };
/** Une illustration : des taches de couleur douces (somme de gaussiennes), reproductibles par graine. */
function illustration(graine, L, H) {
    const r = alea(graine), taches = Array.from({ length: 9 }, () => ({ x: r() * L, y: r() * H, s: 12 + r() * 40, c: [r() * 255, r() * 255, r() * 255] }));
    const px = Buffer.alloc(L * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) {
        let w = 0, c = [0, 0, 0];
        for (const t of taches) { const g = Math.exp(-((x - t.x) ** 2 + (y - t.y) ** 2) / (2 * t.s * t.s)); w += g; for (let k = 0; k < 3; k++) c[k] += g * t.c[k]; }
        for (let k = 0; k < 3; k++) px[(y * L + x) * 3 + k] = Math.max(0, Math.min(255, w > 1e-6 ? c[k] / w : 128));
    }
    return px;
}
/** Une carte : cadre jaune, bandeau de titre (étiquette incrustée) et pied, l'illustration au centre (x 6-94 %, y 11-52 %). */
async function carte(graine, { largeur = 255, hauteur = 361, decalage = 0, luminosite = 1, pied = 0 } = {}) {
    const L = Math.round(largeur * 0.88), H = Math.round(hauteur * 0.41);
    const art = await sharp(illustration(graine, L, H), { raw: { width: L, height: H, channels: 3 } }).linear(luminosite, 0).raw().toBuffer();
    const fond = await sharp({ create: { width: largeur, height: hauteur, channels: 3, background: { r: 240, g: 200, b: 40 } } }).png().toBuffer();
    const bandeau = await sharp({ create: { width: Math.round(largeur * 0.88), height: Math.round(hauteur * 0.07), channels: 3, background: { r: 20 + pied, g: 20, b: 20 } } }).png().toBuffer();
    const artPng = await sharp(art, { raw: { width: L, height: H, channels: 3 } }).png().toBuffer();
    return sharp(fond).composite([{ input: bandeau, left: Math.round(largeur * 0.06), top: Math.round(hauteur * 0.035) },
        { input: artPng, left: Math.round(largeur * 0.06) + decalage, top: Math.round(hauteur * 0.11) + decalage },
        { input: bandeau, left: Math.round(largeur * 0.06), top: Math.round(hauteur * 0.90) }]).jpeg({ quality: 92 }).toBuffer();
}

(async () => {
    const A = await E.empreinteDe(await carte(1));
    const A2 = await E.empreinteDe(await carte(1));
    const B = await E.empreinteDe(await carte(2));
    verifier('la taille d\'une empreinte est fixe (largeur × hauteur × 3)', A.length, E.LARGEUR * E.HAUTEUR * 3);
    vrai('la même image : distance 0 (à l\'arrondi près)', E.distance(A, A2).distance < 1e-6, `d=${E.distance(A, A2).distance}`);
    vrai('deux illustrations différentes : distance élevée (≥ 0,5)', E.distance(A, B).distance >= 0.5, `d=${E.distance(A, B).distance.toFixed(3)}`);
    const vignette = await E.empreinteDe(await sharp(await carte(1)).resize(200, 281).webp({ quality: 80 }).toBuffer());
    vrai('la MÊME carte à 200 px de large (la vignette) : distance < 0,10', E.distance(A, vignette).distance < 0.10, `d=${E.distance(A, vignette).distance.toFixed(3)}`);
    const decalee = await E.empreinteDe(await carte(1, { decalage: 4 }));
    vrai('la même illustration décalée de 4 px (cadrage différent) : distance < 0,15', E.distance(A, decalee).distance < 0.15, `d=${E.distance(A, decalee).distance.toFixed(3)}`);
    const sombre = await E.empreinteDe(await carte(1, { luminosite: 0.7 }));
    vrai('la même carte plus sombre : distance < 0,10 (corrélation normalisée, pas une différence de pixels)', E.distance(A, sombre).distance < 0.10, `d=${E.distance(A, sombre).distance.toFixed(3)}`);
    const autrePied = await E.empreinteDe(await carte(1, { pied: 90 }));
    vrai('la même illustration, bandeau de titre d\'une autre teinte : le bandeau est IGNORÉ (distance < 0,05)', E.distance(A, autrePied).distance < 0.05, `d=${E.distance(A, autrePied).distance.toFixed(3)}`);
    const viree = await E.empreinteDe(await sharp(await carte(1)).recomb([[0, 0, 1], [0, 1, 0], [1, 0, 0]]).jpeg({ quality: 92 }).toBuffer());
    vrai('la couleur de la même image : 0', E.couleur(A, A2) < 1e-9, `c=${E.couleur(A, A2)}`);
    vrai('la même illustration aux teintes permutées (rouge↔bleu) : la couleur le voit (> 0,05)', E.couleur(A, viree) > 0.05, `c=${E.couleur(A, viree).toFixed(3)}`);
    vrai('la couleur est symétrique et dans [0, 1]', Math.abs(E.couleur(A, viree) - E.couleur(viree, A)) < 1e-9 && E.couleur(A, B) <= 1);
    vrai('la distance est symétrique', Math.abs(E.distance(A, decalee).distance - E.distance(decalee, A).distance) < 1e-9);
    vrai('une distance reste dans [0, 1]', [E.distance(A, B).distance, E.distance(A, A2).distance, E.distance(A, decalee).distance].every(d => d >= 0 && d <= 1));

    // l'image sans contraste : Cardmarket « image non disponible », un aplat
    const plat = await sharp({ create: { width: 255, height: 361, channels: 3, background: { r: 128, g: 128, b: 128 } } }).jpeg().toBuffer();
    const P = await E.empreinteDe(plat);
    verifier('un aplat : sans contraste', E.sansContraste(P), true);
    verifier('une illustration : avec contraste', E.sansContraste(A), false);
    verifier('une distance à un aplat : NaN (l\'empreinte ne peut pas conclure)', Number.isNaN(E.distance(A, P).distance), true);
    // format : une image qui n'est pas une carte (300×300) n'est pas comparable
    verifier('rapport hauteur/largeur d\'une carte : accepté', E.formatDeCarte(255, 361), true);
    verifier('une image carrée (300×300) : pas une carte', E.formatDeCarte(300, 300), false);
    verifier('dimensions illisibles : pas une carte', E.formatDeCarte(0, 361), false);
    // l'entrée vide ou de mauvaise taille LÈVE (jamais une distance sur du vide)
    let leve = false; try { E.distance(Buffer.alloc(10), A); } catch { leve = true; }
    verifier('une empreinte de mauvaise taille LÈVE', leve, true);
    leve = false; try { await E.empreinteDe(Buffer.from('pas une image')); } catch { leve = true; }
    verifier('un fichier qui n\'est pas une image LÈVE (l\'appelant le note, il ne fabrique pas une empreinte)', leve, true);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
