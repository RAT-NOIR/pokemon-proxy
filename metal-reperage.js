// METAL — ÉTAPE 1 : le repérage des cartes en matière spéciale rangées comme V2+ d'une carte normale. LECTURE SEULE (export local + vignettes du testeur).
// node metal-reperage.js            -> écrit couverture/S7/METAL/candidats.json (seul chemin écrit, sous la garde d'écriture avec la racine METAL)
// Population : les produits d'un MÊME idExpansion et d'un MÊME idMetacard (≥ 2 produits) — le « V2 » d'une carte chez Cardmarket.
// Aucune requête réseau, aucune écriture en base, le dossier CARDMARKET IMAGE n'est jamais écrit.
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { indexerDisque } = require('./collecte-cartes/staff-detect-io');
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const D = require('./collecte-cartes/metal-detect');
const LECTURE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\scratch\\lecture.js';   // base cartes, utilisateur de LECTURE seule
// Indices de nom d'expansion : coffrets Ultra-Premium, 151, Celebrations, Crown Zenith, anniversaires, « metal », « gold »… (un INDICE, jamais une preuve)
const INDICE_NOM = /ultra[- ]?premium|premium collection|metal|gold|151|celebrations|crown zenith|anniversary|classic collection|shining|special collection|ex box|upc/i;

const RACINE_METAL = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\METAL';
const EXPORT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\c-imports-gha\\products_singles_6.json';
const LARGEUR = 64, HAUTEUR = 90;

async function lireImage(fichier) {
    const { data, info } = await sharp(fichier).removeAlpha().resize({ width: LARGEUR, height: HAUTEUR, fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Les groupes (idExpansion, idMetacard) de ≥ 2 produits. Un idMetacard absent ou nul n'est pas une clé. */
function groupes(produits) {
    const g = new Map();
    for (const p of produits) {
        if (!p.idMetacard) continue;
        const k = `${p.idExpansion}|${p.idMetacard}`;
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(p);
    }
    return [...g.values()].filter(a => a.length >= 2);
}

function ecrire(chemin, contenu) {
    const cible = autoriser(chemin, [RACINE_METAL]);
    fs.writeFileSync(cible, contenu);
    return cible;
}

async function main() {
    const ex = JSON.parse(fs.readFileSync(EXPORT, 'utf8'));
    const produits = ex.products || ex;
    const gs = groupes(produits);
    // le nom des expansions (lecture seule de la base) : pour l'indice de nom
    const { ouvrir } = require(LECTURE); const cx = await ouvrir();
    const nomDe = new Map();
    for (const s of await cx.db.collection('sets').find({}, { projection: { nomAffichage: 1, idExpansion: 1 } }).toArray()) for (const e of [].concat(s.idExpansion ?? [])) nomDe.set(e, s.nomAffichage ?? s._id);
    await cx.client.close();
    const disque = indexerDisque();
    const emp = new Map(); let sansVignette = 0, illisibles = 0;
    for (const a of gs) for (const p of a) {
        const f = disque.get(p.idProduct);
        if (!f) { sansVignette++; continue; }
        try { emp.set(p.idProduct, D.empreinte(await lireImage(f))); } catch (e) { illisibles++; }
    }
    const candidats = [], parVerdict = {};
    for (const a of gs) for (const p of a) {
        const e = emp.get(p.idProduct); if (!e) continue;
        const freres = a.filter(q => q.idProduct !== p.idProduct && emp.has(q.idProduct));
        const v = D.verdictMatiere(e, freres.map(q => emp.get(q.idProduct)));
        parVerdict[v.verdict] = (parVerdict[v.verdict] || 0) + 1;
        if (v.verdict === 'normal') continue;
        const meilleur = freres.filter(q => D.classerMatiere(emp.get(q.idProduct)) === null).sort((x, y) => emp.get(y.idProduct).borderV - emp.get(x.idProduct).borderV)[0] || null;
        candidats.push({ idProduct: p.idProduct, name: p.name, idExpansion: p.idExpansion, idMetacard: p.idMetacard, dateAdded: p.dateAdded, verdict: v.verdict, classe: v.classe, score: Math.round(v.score * 1000) / 1000, motif: v.motif ?? null,
            expansion: nomDe.get(p.idExpansion) ?? null, indiceNom: INDICE_NOM.test(nomDe.get(p.idExpansion) ?? ''), empreinte: e, frereRef: meilleur ? meilleur.idProduct : null, freres: freres.map(q => q.idProduct), vignette: disque.get(p.idProduct), vignetteFrere: meilleur ? disque.get(meilleur.idProduct) : null });
    }
    candidats.sort((x, y) => (x.verdict === 'metal' ? 0 : x.verdict === 'autre-matiere' ? 1 : 2) - (y.verdict === 'metal' ? 0 : y.verdict === 'autre-matiere' ? 1 : 2) || y.score - x.score || x.idProduct - y.idProduct);
    const entete = { date: '2026-10-17', export: path.basename(EXPORT), produitsExport: produits.length, groupes: gs.length, produitsDansGroupes: gs.reduce((n, a) => n + a.length, 0),
        empreintesLues: emp.size, sansVignette, illisibles, parVerdict, expansionsSansNom: [...new Set(candidats.filter(c => !c.expansion).map(c => c.idExpansion))].length, constantes: { OR: D.OR, ARGENT: D.ARGENT, CLAIR: D.CLAIR, ECART_MIN: D.ECART_MIN } };
    const sortie = ecrire(path.join(RACINE_METAL, 'candidats.json'), JSON.stringify({ entete, candidats }, null, 1));
    console.log(JSON.stringify(entete, null, 1)); console.log('écrit', sortie, candidats.length, 'candidats');
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { groupes, lireImage, RACINE_METAL, EXPORT };
