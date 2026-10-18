// METAL — correction 1, M2 : l'énumération par le TEXTE (lecture seule, aucune requête, aucun dessin des douteux). Les champs « metal » / matière spéciale :
//   · TCGdex (clone local) : les types de variante autres que normal / reverse / holo (ex. `metal`, `lenticular`) et leurs idProduct Cardmarket (`thirdParty.cardmarket`) ;
//   · les noms de produits Cardmarket de l'export (« metal card », « gold », « lenticular », « ultra-premium »…) ;
//   · PTCG-database (JSON seulement, rien exécuté) : rareté, étiquettes, nom, adresse ;
//   · l'index Pokumon : AUCUN cache local (seul le code du collecteur existe) — dit, pas supposé.
// Pour chaque candidat trouvé avec un idProduct et une vignette : une PLANCHE contre son frère de même métacarte ; RIEN n'entre dans la table sans que le coordinateur regarde.
// node metal-texte.js -> couverture/S7/METAL/candidats-texte.json + planches-texte/
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const { indexerDisque } = require('./collecte-cartes/staff-detect-io');
const { RACINE_METAL, EXPORT } = require('./metal-reperage');

const B = 'C:\\Users\\Yung\\rat-market-travail\\catalogue';
const TCGDEX = path.join(B, 'exports', 'tcgdex-clone-2026-09-25', 'data');
const PTCGDB = path.join(B, 'sources-externes', 'PTCG-database', 'data_en');
// les types de variante ORDINAIRES de TCGdex : tout autre est une matière ou une erreur d'impression, à lire
const VARIANTES_ORDINAIRES = new Set(['normal', 'reverse', 'holo', 'firstEdition']);
const MATIERE_TCGDEX = /^(metal|lenticular|gold|golden|foil-metal|acrylic|wooden|plastic)$/i;
// un nom de produit Cardmarket qui dit la matière (jamais « Metal Energy », « Melmetal »…, « Metal Saucer » : des noms de cartes ordinaires)
const MATIERE_NOM = /\b(metal|gold|golden|lenticular|wooden|acrylic|silver|platinum)\s+(card|version|edition)\b|\bmetal\s+card\b|\bgold\s+metal\b|\bultra[- ]premium\b|\(metal\)|\[metal\]/i;

function* fichiers(d, re) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) yield* fichiers(p, re); else if (re.test(e.name)) yield p; } }

function enumererTcgdex() {
    const trouves = [], types = {};
    for (const f of fichiers(TCGDEX, /\.ts$/)) {
        const t = fs.readFileSync(f, 'utf8');
        const m = /variants:\s*\[([\s\S]*?)\n\t\],?/.exec(t);
        if (!m) continue;
        const blocs = m[1].split(/\n\t\t\{/).filter(Boolean);
        for (const b of blocs) {
            const type = (/type:\s*['"]([^'"]+)['"]/.exec(b) || [])[1];
            if (!type) continue;
            types[type] = (types[type] || 0) + 1;
            if (VARIANTES_ORDINAIRES.has(type)) continue;
            if (!MATIERE_TCGDEX.test(type)) continue;
            trouves.push({ fichier: path.relative(TCGDEX, f), nom: (/name:\s*\{\s*en:\s*"([^"]+)"/.exec(t) || [])[1] ?? null, variante: type, idProductCardmarket: (/cardmarket:\s*(\d+)/.exec(b) || [])[1] ? Number(/cardmarket:\s*(\d+)/.exec(b)[1]) : null });
        }
    }
    return { trouves, types };
}

function enumererPtcgdb() {
    const hits = []; let n = 0;
    for (const f of fichiers(PTCGDB, /\.json$/)) {
        let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
        n++;
        const champs = [j.rarity, ...(j.tags || []), j.series_note, j.finish].filter(x => typeof x === 'string');
        if (champs.some(c => MATIERE_NOM.test(c) || MATIERE_TCGDEX.test(c.trim()))) hits.push({ fichier: path.relative(PTCGDB, f), name: j.name, rarity: j.rarity ?? null, url: j.url });
    }
    return { hits, lus: n };
}

async function main() {
    const ex = JSON.parse(fs.readFileSync(EXPORT, 'utf8')); const produits = ex.products || ex;
    const tcg = enumererTcgdex(), ptcg = enumererPtcgdb();
    const parNom = produits.filter(p => MATIERE_NOM.test(p.name) && !/code card/i.test(p.name)).map(p => ({ idProduct: p.idProduct, name: p.name, idExpansion: p.idExpansion, idMetacard: p.idMetacard }));
    const ids = new Set([...tcg.trouves.map(x => x.idProductCardmarket), ...parNom.map(x => x.idProduct)].filter(Number.isInteger));
    const parId = new Map(produits.map(p => [p.idProduct, p]));
    const disque = indexerDisque();
    const candidats = [];
    for (const id of ids) {
        const p = parId.get(id); if (!p) { candidats.push({ idProduct: id, motif: 'idProduct absent de l\'export', vignette: false }); continue; }
        const freres = produits.filter(q => q.idMetacard && q.idMetacard === p.idMetacard && q.idExpansion === p.idExpansion && q.idProduct !== id);
        const frere = freres.find(q => disque.get(q.idProduct)) || null;
        candidats.push({ idProduct: id, name: p.name, idExpansion: p.idExpansion, idMetacard: p.idMetacard, sources: [...(tcg.trouves.some(x => x.idProductCardmarket === id) ? ['tcgdex'] : []), ...(parNom.some(x => x.idProduct === id) ? ['nom-cardmarket'] : [])],
            vignette: disque.get(id) ?? null, frere: frere ? frere.idProduct : null, vignetteFrere: frere ? disque.get(frere.idProduct) : null, dejaEnTable: !!require('./collecte-cartes/matiere-speciale').estMatiereSpeciale(id) });
    }
    // les planches : une par candidat avec vignette ET frère (le coordinateur regarde)
    const dossier = autoriser(path.join(RACINE_METAL, 'planches-texte'), [RACINE_METAL]); fs.mkdirSync(dossier, { recursive: true });
    const aDessiner = candidats.filter(c => c.vignette && c.vignetteFrere);
    const VW = 200, VH = 280;
    for (let n = 0; n * 6 < aDessiner.length; n++) {
        const lot = aDessiner.slice(n * 6, n * 6 + 6), compos = [];
        for (let i = 0; i < lot.length; i++) {
            const c = lot[i], x0 = (i % 2) * (2 * VW + 24), y0 = Math.floor(i / 2) * (VH + 40);
            for (const [k, f] of [[0, c.vignette], [1, c.vignetteFrere]]) compos.push({ input: await sharp(f).resize({ width: VW, height: VH, fit: 'contain', background: '#202020' }).png().toBuffer(), left: x0 + k * VW, top: y0 });
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * VW}" height="40"><rect width="100%" height="100%" fill="#101010"/><text x="4" y="16" font-family="Arial" font-size="13" fill="#ffd54a">${c.idProduct} ${c.sources.join('+')}${c.dejaEnTable ? ' (déjà en table)' : ''}</text><text x="4" y="33" font-family="Arial" font-size="12" fill="#fff">${String(c.name).replace(/[<>&"]/g, ' ').slice(0, 44)} · frère ${c.frere}</text></svg>`;
            compos.push({ input: Buffer.from(svg), left: x0, top: y0 + VH });
        }
        await sharp({ create: { width: 2 * (2 * VW + 24), height: Math.ceil(lot.length / 2) * (VH + 40), channels: 3, background: '#000' } }).composite(compos).png().toFile(autoriser(path.join(dossier, `planche-texte-${String(n + 1).padStart(2, '0')}.png`), [RACINE_METAL]));
    }
    const sortie = { date: '2026-10-18', instrument: 'lecture de fichiers locaux, zéro requête',
        tcgdex: { variantesVues: tcg.types, matiere: tcg.trouves }, ptcgdb: { fichiersLus: ptcg.lus, matiere: ptcg.hits }, pokumon: 'aucun cache local (seul le code du collecteur est dans le dépôt)',
        cardmarketNoms: parNom, candidats, planches: Math.ceil(aDessiner.length / 6),
        manquentAuxSources: candidats.filter(c => !c.vignette || !c.vignetteFrere).map(c => ({ idProduct: c.idProduct, name: c.name ?? null, raison: !c.vignette ? 'aucune vignette locale' : 'aucun frère de même métacarte avec vignette' })) };
    fs.writeFileSync(autoriser(path.join(RACINE_METAL, 'candidats-texte.json'), [RACINE_METAL]), JSON.stringify(sortie, null, 1));
    console.log(JSON.stringify({ tcgdexMatiere: tcg.trouves.length, ptcgdbMatiere: ptcg.hits.length, nomsCardmarket: parNom.length, candidats: candidats.length, planches: sortie.planches, manquent: sortie.manquentAuxSources.length }));
    console.log(JSON.stringify(tcg.trouves)); console.log(parNom.slice(0, 30).map(x => `${x.idProduct} ${x.name}`).join('\n'));
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { MATIERE_NOM, MATIERE_TCGDEX, VARIANTES_ORDINAIRES };
