// node test-vignette.js — banc du module des vignettes (collecte-cartes/vignette.js), SANS R2 ni base : la règle pure
// (clé, dimensions, proportion) et la fabrication sur des images fabriquées par sharp.
const sharp = require('sharp');
const { cleVignette, fabriquerVignette, LARGEUR_VIGNETTE, LARGEUR_VIGNETTE_LOGO } = require('./collecte-cartes/vignette');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const image = (w, h, alpha = false) => sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: alpha ? { r: 10, g: 20, b: 30, alpha: 0.5 } : { r: 200, g: 100, b: 50 } } }).webp().toBuffer();

(async () => {
    verifier('clé : sous « vignettes/ », l\'extension remplacée par .webp, jamais la clé de l\'image',
        [cleVignette('tcgdex/151/200-283654.webp'), cleVignette('bulbapedia/Arceus/89-41586.webp'), cleVignette('logos/EX-Holon-Phantoms.png')],
        ['vignettes/tcgdex/151/200-283654.webp', 'vignettes/bulbapedia/Arceus/89-41586.webp', 'vignettes/logos/EX-Holon-Phantoms.webp']);
    let leve = null; try { cleVignette('vignettes/x.webp'); } catch (e) { leve = e.message; }
    verifier('une clé déjà sous « vignettes/ » LÈVE (on ne réduit pas une vignette)', /vignette/.test(leve || ''), true);
    // une carte 600×825 (TCGdex) → 200 px, même proportion (le site refuse au-delà de 5 %)
    const v = await fabriquerVignette(await image(600, 825));
    const meta = await sharp(v.buffer).metadata();
    verifier('carte 600×825 → 200×275 en WebP, dimensions RELUES dans le fichier',
        [v.w, v.h, meta.width, meta.height, meta.format, Math.abs(v.w / v.h - 600 / 825) / (600 / 825) < 0.05], [200, 275, 200, 275, 'webp', true]);
    // une image PLUS ÉTROITE que la cible n'est pas agrandie
    const petite = await fabriquerVignette(await image(160, 220));
    verifier('une image de 160 px n\'est pas agrandie', [petite.w, petite.h], [160, 220]);
    // un logo (transparence) → 400 px au plus, la transparence gardée
    const logo = await fabriquerVignette(await image(5600, 2074, true), { largeur: LARGEUR_VIGNETTE_LOGO });
    const ml = await sharp(logo.buffer).metadata();
    verifier('logo 5600×2074 → 400 px, alpha gardé', [logo.w, ml.hasAlpha, LARGEUR_VIGNETTE], [400, true, 200]);
    let vide = null; try { await fabriquerVignette(Buffer.from('pas une image')); } catch (e) { vide = e.message; }
    verifier('un fichier illisible LÈVE (pas de vignette vide)', !!vide, true);
    // generer-vignettes --ecrire sans secret de revalidation REFUSE AVANT toute connexion : sinon deux heures d'écriture, puis une
    // revalidation impossible, et une relance ne retrouve plus les sets (tout est déjà vignetté) — revue du 2026-09-27
    const g = require('child_process').spawnSync(process.execPath, ['generer-vignettes.js', '--ecrire', '--slug=banc-set-inexistant'], { cwd: __dirname, env: { ...process.env, REVALIDATION_SECRET: '' }, encoding: 'utf8', timeout: 120000 });
    verifier('generer-vignettes --ecrire sans REVALIDATION_SECRET : code 2, le secret nommé, aucune connexion ouverte',
        [g.status, /REVALIDATION_SECRET/.test(g.stderr || ''), /cible :/.test(g.stdout || '')], [2, true, false]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
