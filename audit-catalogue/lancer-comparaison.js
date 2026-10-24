'use strict';
// node audit-catalogue/lancer-comparaison.js — la distance de CHAQUE paire (notre vignette servie | la copie locale Cardmarket), SANS aucun seuil.
//   Entrées : S8\AUDIT\etat-produits.json (lancer-etat.js), cache\empreintes-cm.* et cache\empreintes-nous.* (lancer-empreintes.js).
//   Sortie : S8\AUDIT\comparaisons.json — { idProduct, classe, distance, ncc, dx, dy, couleur, comparable, motif } par produit servi, + résumé.
// Les classes PROBABLEMENT FAUX / CONFORME ne sont PAS posées ici : elles attendent les seuils du coordinateur (planche de calibration), puis le second passage.
const fs = require('fs');
const E = require('./empreinte');
const C = require('./classement');
const { lireJson, sortie, ecrireJson } = require('./ecrire');

function lireJeu(nom) {
    const meta = lireJson(`cache/${nom}.json`), bin = fs.readFileSync(sortie(`cache/${nom}.bin`));
    if (bin.length !== meta.n * meta.taille || meta.taille !== E.TAILLE) throw new Error(`${nom} : ${bin.length} octets pour ${meta.n} × ${meta.taille} — jeu incohérent`);
    const index = new Map(meta.cles.map((c, i) => [c, i]));
    return { meta, bin, index, empreinte: i => (meta.infos[i].erreur ? null : bin.subarray(i * meta.taille, (i + 1) * meta.taille)) };
}

/** Le jugement d'UNE paire. Pure sur ses entrées : l'empreinte, les dimensions, le drapeau « copie locale ». */
function juger({ classe, copieLocale, fpNous, dimNous, fpCm, dimCm }) {
    const platCm = fpCm ? E.sansContraste(fpCm) : false, platNous = fpNous ? E.sansContraste(fpNous) : false;
    const cmCarte = dimCm ? E.formatDeCarte(dimCm.w, dimCm.h) : false, nousCarte = dimNous ? E.formatDeCarte(dimNous.w, dimNous.h) : false;
    // « non disponible » : un aplat (rien à comparer) OU une image qui n'a pas la forme d'une carte (visuel carré, produit scellé)
    const placeholderCm = Boolean(fpCm) && (platCm || !cmCarte);
    const empreinteNous = Boolean(fpNous) && nousCarte && !platNous;
    const empreinteCm = Boolean(fpCm) && !platCm;
    const d = fpNous && fpCm && !platNous && !platCm ? E.distance(fpNous, fpCm) : { distance: NaN, ncc: NaN, dx: 0, dy: 0 };
    const comp = C.etatComparaison({ copieLocale, placeholderCm, empreinteNous, empreinteCm, distance: d.distance });
    const motif = comp.comparable ? null : (comp.motif === 'copie-cardmarket-non-disponible' && !platCm && !cmCarte ? 'copie-cardmarket-format-inattendu' : comp.motif === 'visuel-nous-illisible' && fpNous && !nousCarte ? 'visuel-nous-format-inattendu' : comp.motif);
    return { comparable: comp.comparable, motif, distance: comp.comparable ? d.distance : null, ncc: comp.comparable ? d.ncc : null, dx: comp.comparable ? d.dx : null, dy: comp.comparable ? d.dy : null,
        couleur: comp.comparable ? E.couleur(fpNous, fpCm) : null };
}

/**
 * L'enregistrement d'une paire (L3) : on CLASSE sur la distance BRUTE, puis on écrit la distance BRUTE (relue, elle classe pareil : 0,5499996 arrondi à 0,55 aurait basculé en INCERTAIN).
 * Seuls `ncc` et `couleur` sont arrondis (ce ne sont pas des seuils).
 */
function enregistrer({ idProduct, classe, motifsClasse, nom, r }) {
    const cc = C.classerComparaison({ comparaison: { comparable: r.comparable, motif: r.motif }, distance: r.distance, nom });
    return { idProduct, classe, motifsClasse, ...r, classeComparaison: cc.classe, ncc: r.ncc === null ? null : +r.ncc.toFixed(5), couleur: r.couleur === null ? null : +r.couleur.toFixed(5) };
}

if (require.main === module) {
    const t0 = Date.now();
    const produits = lireJson('etat-produits.json');
    const cm = lireJeu('empreintes-cm'), nous = lireJeu('empreintes-nous');
    const servis = produits.filter(p => p.visuel.entree);
    console.log(`DÉNOMINATEURS : produits ${produits.length} · servis ${servis.length} · avec copie locale ${servis.filter(p => p.copieLocale).length} · empreintes CM ${cm.meta.n} (illisibles ${cm.meta.infos.filter(x => x.erreur).length}) · empreintes nous ${nous.meta.n} (illisibles ${nous.meta.infos.filter(x => x.erreur).length})`);
    const sortieJ = [], motifs = {}, parClasse = {};
    let tCalc = 0;
    for (const p of servis) {
        const iCm = cm.index.get(p.idProduct), cle = p.visuel.entree.vignette?.cle, iN = cle ? nous.index.get(cle) : undefined;
        const r = p.copieLocale && iCm !== undefined && iN !== undefined
            ? (() => { const a = process.hrtime.bigint(); const j = juger({ classe: p.visuel.classe, copieLocale: true, fpNous: nous.empreinte(iN), dimNous: nous.meta.infos[iN], fpCm: cm.empreinte(iCm), dimCm: cm.meta.infos[iCm] }); tCalc += Number(process.hrtime.bigint() - a); return j; })()
            : { comparable: false, motif: p.copieLocale ? 'empreinte-absente' : 'pas-de-copie-locale', distance: null, ncc: null, dx: null, dy: null, couleur: null };
        const e = enregistrer({ idProduct: p.idProduct, classe: p.visuel.classe, motifsClasse: p.visuel.motifs, nom: p.name, r });
        sortieJ.push(e);
        const k = e.comparable ? 'comparable' : e.motif; motifs[k] = (motifs[k] || 0) + 1;
        const c = (parClasse[e.classe] ||= { servis: 0, comparables: 0 }); c.servis++; if (e.comparable) c.comparables++;
    }
    const dist = sortieJ.filter(e => e.comparable).map(e => e.distance).sort((a, b) => a - b);
    const q = f => dist[Math.min(dist.length - 1, Math.floor(f * dist.length))];
    const resume = { le: new Date().toISOString(), servis: servis.length, comparables: dist.length, motifs, parClasse, deciles: Object.fromEntries([0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map(f => [f, q(f)])),
        msParPaire: +(tCalc / 1e6 / Math.max(1, dist.length)).toFixed(3), secondes: Math.round((Date.now() - t0) / 1000) };
    ecrireJson('comparaisons.json', { resume, paires: sortieJ });
    console.log(JSON.stringify(resume, null, 1));
}

module.exports = { juger, lireJeu, enregistrer };
