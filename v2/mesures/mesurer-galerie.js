'use strict';
// GALERIE, TOUR 1 — deux mesures, aucune ressource externe, base en mémoire :
//   1. le PIC de mémoire (RSS) du traitement d'une image : une image de 12 Mpx acceptée, une image refusée (trop de pixels, rejetée sur l'en-tête avant tout décodage), et le socle du processus.
//      Chaque scénario tourne dans un processus NEUF (le pic d'un processus ne redescend pas) ; le pic est `process.resourceUsage().maxRSS` en fin de traitement, et l'échantillonnage toutes les 5 ms le confirme.
//   2. le temps de la recherche `q` de la banque sur 20 000 arts : l'ancienne recherche (regex non ancrée sur le nom et le pseudo) contre la nouvelle (préfixes de mots sur l'index multiclé).
// Lancement : node v2/mesures/mesurer-galerie.js
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs'), os = require('os');

const MIO = 1024 * 1024;
async function fabriquer(scenario) {
    const sharp = require('sharp');
    if (scenario === '12mpx') {
        // un dégradé lisse 4000 × 3000 en JPEG (réaliste : une photo de carte), sous les 8 Mio
        const raw = Buffer.alloc(4000 * 3000 * 3); for (let y = 0; y < 3000; y++) for (let x = 0; x < 4000; x++) { const i = (y * 4000 + x) * 3; raw[i] = (x * 255 / 4000) | 0; raw[i + 1] = (y * 255 / 3000) | 0; raw[i + 2] = ((x + y) * 255 / 7000) | 0; }
        return sharp(raw, { raw: { width: 4000, height: 3000, channels: 3 } }).jpeg({ quality: 70 }).toBuffer();
    }
    // 25 Mpx déclarés dans l'en-tête (5000 × 5000), PNG uni : refusé sur l'en-tête, sans décodage
    return sharp({ create: { width: 5000, height: 5000, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png({ compressionLevel: 9 }).toBuffer();
}
async function enfant(scenario, fichier) {
    const I = require('../galerie/images');
    const base = process.resourceUsage().maxRSS / 1024;
    if (scenario === 'socle') { console.log(JSON.stringify({ scenario, socleMo: Math.round(base), picMo: Math.round(base) })); return; }
    const buf = require('fs').readFileSync(fichier), declare = null;
    const avantMo = process.resourceUsage().maxRSS / 1024;
    let pic = 0; const t = setInterval(() => { pic = Math.max(pic, process.memoryUsage().rss / MIO); }, 5);
    const t0 = Date.now(); let issue;
    try { const r = await I.traiter(buf, { pixelsMax: 12e6, octetsMax: 8 * MIO, declare }); issue = `acceptée ${r.largeur}x${r.hauteur}`; }
    catch (e) { issue = `refusée (${e && e.detail ? e.detail : e && e.name})`; }
    clearInterval(t);
    console.log(JSON.stringify({ scenario, octetsEntree: buf.length, issue, ms: Date.now() - t0, picEchantillonneMo: Math.round(pic), maxRssFinMo: Math.round(process.resourceUsage().maxRSS / 1024), maxRssAvantTraitementMo: Math.round(avantMo) }));
}

async function rechercheQ() {
    const A = require('../test/_aide-galerie'); const mongoose = require('mongoose');
    const S = require('../galerie/service'); const G = require('../galerie/base');
    await A.H.ouvrirBac('mesurer-galerie.js');          // la base de banc EN MÉMOIRE du dépôt (jamais une grappe réelle)
    const db = mongoose.connection.client.db('rm_galerie_essai'); G.brancher(db);
    const NOMS = ['Fond doux', 'Pikachu electrique', 'Dracaufeu ombre', 'Mew reve', 'Evoli soleil', 'Ronflex sieste', 'Lugia tempete', 'Mimiqui cache'], PSEUDOS = ['luma', 'noa', 'rafale', 'kiwi', 'alba', 'sora', 'milo', 'zen'];
    const docs = []; for (let i = 0; i < 20000; i++) { const nom = `${NOMS[i % 8]} ${i}`, pseudo = `${PSEUDOS[(i * 7) % 8]}${i % 97}`; docs.push({ _id: `a${i}`, etat: i % 10 === 0 ? 'en-attente' : 'public', nom, pseudo, mots: S.motsDe(nom, pseudo), fmt: '1', publieLe: new Date(Date.now() - i * 1000), nbJaime: i % 13, clePublique: `galerie/pub/a${i}`, largeur: 100, hauteur: 100 }); }
    await db.collection('arts').insertMany(docs); await G.creerIndex(db);
    const q = 'ronf'; const N = 30;
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const ancien = { etat: 'public', $or: [{ nom: regex }, { pseudo: regex }] };
    const nouveau = { etat: 'public', ...S.filtreRecherche(q) };
    const temps = async f => { await f(); const t0 = process.hrtime.bigint(); for (let i = 0; i < N; i++) await f(); return Number(process.hrtime.bigint() - t0) / 1e6 / N; };
    const msAncien = await temps(() => db.collection('arts').find(ancien).sort({ publieLe: -1, _id: 1 }).limit(41).toArray());
    const msNouveau = await temps(() => db.collection('arts').find(nouveau).sort({ publieLe: -1, _id: 1 }).limit(41).toArray());
    const [rA, rN] = [await db.collection('arts').find(ancien).limit(41).toArray(), await db.collection('arts').find(nouveau).limit(41).toArray()];
    const plan = await db.collection('arts').find(nouveau).explain('queryPlanner');
    const gagnant = JSON.stringify(plan.queryPlanner.winningPlan);
    console.log(JSON.stringify({ arts: docs.length, q, ancienMs: +msAncien.toFixed(2), nouveauMs: +msNouveau.toFixed(2), resultatsAncien: rA.length, resultatsNouveau: rN.length, indexUtilise: /mots_1_etat_1/.test(gagnant), parcoursComplet: /COLLSCAN/.test(gagnant) }));
    await db.dropDatabase(); await A.H.fermerBac();
}

(async () => {
    const arg = process.argv.find(a => a.startsWith('--enfant=')), fic = process.argv.find(a => a.startsWith('--fichier='));
    if (arg) return enfant(arg.slice(9), fic && fic.slice(10));
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mesure-galerie-'));
    try {
        for (const s of ['socle', '12mpx', 'refusee']) {
            const f = path.join(dossier, s); if (s !== 'socle') fs.writeFileSync(f, await fabriquer(s));
            console.log(execFileSync(process.execPath, [__filename, `--enfant=${s}`, `--fichier=${f}`], { encoding: 'utf8' }).trim());
        }
    } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
    await rechercheQ();
})().catch(e => { console.error('échec de la mesure :', e && e.name, e && String(e.message).slice(0, 200)); process.exit(1); });
