'use strict';
// node audit-catalogue/lancer-planche.js — LA PLANCHE DE CALIBRATION : 200 paires (notre vignette | la copie locale Cardmarket | distance), tirées en strates sur toute l'échelle
// des distances, rendues en planches (3 colonnes × 4 lignes, triées par distance croissante) et décrites dans calibration-200.json. Le coordinateur les REGARDE et fixe les seuils :
// rien ici ne classe PROBABLEMENT FAUX ou CONFORME.
//   Population : les paires COMPARABLES dont le visuel est celui du set (classes « à comparer » et « basse définition ») — les EMPRUNTÉS sont des visuels d'un autre tirage par construction,
//   ils brouilleraient la calibration d'un seuil qui doit dire « bon dessin / mauvais dessin » pour le visuel du set.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { stratifier, binDe } = require('./stratifier');
const { lireJson, sortie, ecrireJson } = require('./ecrire');
const { indexerDisque } = require('../collecte-cartes/staff-detect-io');

const GRAINE = 20261024, TOTAL = 200;
const BORNES = Array.from({ length: 21 }, (_, i) => +(i * 0.05).toFixed(2));          // 20 strates de 0,05
const L = 200, H = 281, MARGE = 12, LEGENDE = 50, COLONNES = 3, LIGNES = 4;
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const echapper = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

async function vignette(chemin) { return sharp(chemin).flatten({ background: '#808080' }).resize(L, H, { fit: 'contain', background: '#303030' }).jpeg({ quality: 88 }).toBuffer(); }

(async () => {
    const comp = lireJson('comparaisons.json'), produits = new Map(lireJson('etat-produits.json').map(p => [p.idProduct, p]));
    const idx = indexerDisque();
    const population = comp.paires.filter(e => e.comparable && (e.classe === 'A_COMPARER' || e.classe === 'BASSE_DEFINITION'));
    console.log(`DÉNOMINATEURS : paires ${comp.paires.length} · comparables ${comp.paires.filter(e => e.comparable).length} · population de la planche (comparables, visuel du set) ${population.length}`);
    const S = stratifier(population, { bornes: BORNES, total: TOTAL, graine: GRAINE });
    console.log(`tirage : ${S.choisies.length}/${TOTAL} (manque ${S.manque}) · par strate : ${S.parStrate.map(s => `${s.borne[0].toFixed(2)}:${s.tirees}/${s.disponibles}`).join(' ')}`);
    const paires = S.choisies.map((e, i) => {
        const p = produits.get(e.idProduct), cle = p.visuel.entree.vignette.cle;
        return { rang: i + 1, idProduct: e.idProduct, distance: e.distance, ncc: e.ncc, couleur: e.couleur, dx: e.dx, dy: e.dy, classe: e.classe, strate: binDe(e.distance, BORNES),
            nom: p.name, setId: p.setId, numeroFiche: p.fiche.numero, preuves: p.preuves,
            nous: { cleR2: cle, chemin: sortie(`cache-nos-vignettes/${sha1(cle)}.webp`) }, cardmarket: { chemin: idx.get(e.idProduct) } };
    });
    for (const x of paires) for (const [k, c] of [['nous', x.nous.chemin], ['cardmarket', x.cardmarket.chemin]]) if (!c || !fs.existsSync(c)) throw new Error(`pair ${x.idProduct} : fichier ${k} introuvable`);
    const parPlanche = COLONNES * LIGNES, nPlanches = Math.ceil(paires.length / parPlanche);
    const cW = 2 * L + 10 + MARGE, cH = H + LEGENDE + MARGE;
    fs.mkdirSync(sortie('calibration'), { recursive: true });
    for (let n = 0; n < nPlanches; n++) {
        const lot = paires.slice(n * parPlanche, (n + 1) * parPlanche), comps = [];
        for (let k = 0; k < lot.length; k++) {
            const x = lot[k], col = k % COLONNES, lig = Math.floor(k / COLONNES), X = MARGE + col * cW, Y = MARGE + lig * cH;
            x.planche = { fichier: `calibration/planche-${String(n + 1).padStart(2, '0')}.jpg`, ligne: lig + 1, colonne: col + 1 };
            comps.push({ input: await vignette(x.nous.chemin), left: X, top: Y }, { input: await vignette(x.cardmarket.chemin), left: X + L + 10, top: Y });
            const svg = `<svg width="${2 * L + 10}" height="${LEGENDE}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/>`
                + `<text x="6" y="19" font-family="Arial, sans-serif" font-size="17" font-weight="bold" fill="#fff">#${x.rang}   d = ${x.distance.toFixed(3)}</text>`
                + `<text x="${L + 16}" y="19" font-family="Arial, sans-serif" font-size="13" fill="#9cf">ncc ${x.ncc.toFixed(2)} · couleur ${x.couleur.toFixed(2)}</text>`
                + `<text x="6" y="41" font-family="Arial, sans-serif" font-size="13" fill="#ddd">${echapper(`${x.idProduct} · ${x.nom}`.slice(0, 58))}</text></svg>`;
            comps.push({ input: Buffer.from(svg), left: X, top: Y + H });
        }
        const W = MARGE + COLONNES * cW, Ht = MARGE + LIGNES * cH;
        await sharp({ create: { width: W, height: Ht, channels: 3, background: '#4a4a4a' } }).composite(comps).jpeg({ quality: 86 }).toFile(sortie(`calibration/planche-${String(n + 1).padStart(2, '0')}.jpg`));
    }
    ecrireJson('calibration-200.json', { le: new Date().toISOString(), graine: GRAINE, total: TOTAL, tires: paires.length, bornes: BORNES, parStrate: S.parStrate,
        population: { description: 'paires comparables, classes A_COMPARER et BASSE_DEFINITION (le visuel du set)', n: population.length }, planches: nPlanches,
        lecture: 'À gauche NOTRE vignette servie, à droite la copie locale Cardmarket. « distance » : 1 − max(corrélation normalisée du centre de l\'illustration, 0), recalage ±5/±4 ; 0 = même dessin, 1 = aucune corrélation. Les paires sont rangées par distance croissante.',
        paires }, { indent: 1 });
    console.log(`✅ ${nPlanches} planches dans S8\\AUDIT\\calibration\\ et calibration-200.json (${paires.length} paires)`);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
