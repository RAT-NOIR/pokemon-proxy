'use strict';
// node audit-catalogue/lancer-planche.js — LA PLANCHE DE CALIBRATION : 200 paires (notre vignette | la copie locale Cardmarket | distance), tirées en strates sur toute l'échelle
// des distances, rendues en planches (3 colonnes × 4 lignes, triées par distance croissante) et décrites dans calibration-200.json. Le coordinateur les REGARDE et fixe les seuils :
// rien ici ne classe PROBABLEMENT FAUX ou CONFORME.
//   Population : les paires COMPARABLES dont le visuel est celui du set (classes « à comparer » et « basse définition ») — les EMPRUNTÉS sont des visuels d'un autre tirage par construction,
//   ils brouilleraient la calibration d'un seuil qui doit dire « bon dessin / mauvais dessin » pour le visuel du set.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { rendrePlanches } = require('./rendu-planche');
const { stratifier, binDe } = require('./stratifier');
const { lireJson, sortie, ecrireJson } = require('./ecrire');
const { indexerDisque } = require('../collecte-cartes/staff-detect-io');

const GRAINE = 20261024, TOTAL = 200;
const BORNES = Array.from({ length: 21 }, (_, i) => +(i * 0.05).toFixed(2));          // 20 strates de 0,05
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');

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
    // le rendu est celui de rendu-planche.js (une seule définition, aussi pour les planches du livrable)
    const cellules = paires.map(x => ({ nous: x.nous.chemin, cm: x.cardmarket.chemin, titre: `#${x.rang}   d = ${x.distance.toFixed(3)}`, droite: `ncc ${x.ncc.toFixed(2)} · couleur ${x.couleur.toFixed(2)}`, bas: `${x.idProduct} · ${x.nom}` }));
    const fichiers = await rendrePlanches(cellules, { prefixe: 'planche', dossier: 'calibration' });
    paires.forEach((x, i) => { x.planche = cellules[i].planche; });
    const nPlanches = fichiers.length;
    ecrireJson('calibration-200.json', { le: new Date().toISOString(), graine: GRAINE, total: TOTAL, tires: paires.length, bornes: BORNES, parStrate: S.parStrate,
        population: { description: 'paires comparables, classes A_COMPARER et BASSE_DEFINITION (le visuel du set)', n: population.length }, planches: nPlanches,
        lecture: 'À gauche NOTRE vignette servie, à droite la copie locale Cardmarket. « distance » : 1 − max(corrélation normalisée du centre de l\'illustration, 0), recalage ±5/±4 ; 0 = même dessin, 1 = aucune corrélation. Les paires sont rangées par distance croissante.',
        paires }, { indent: 1 });
    console.log(`✅ ${nPlanches} planches dans S8\\AUDIT\\calibration\\ et calibration-200.json (${paires.length} paires)`);
})().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
