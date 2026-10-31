'use strict';
// LOT G-GROUPE — ANALYSE (outil LOCAL, hors lancer-tout) : la COURBE de l'avance exigée (en inliers) sur les trois bancs, calculée avec les fonctions de PRODUCTION (g-groupe.js : ordonnerGroupe, demandeDuGroupe,
// groupeDeLaQuestion), à partir du fichier que extraire-mesures-groupe.js a écrit (les mesures que le client enverrait). Lecture seule.
//   node v2/mesures/analyser-g-groupe.js --mesures=<mesures-bancs.json> [--sortie=<courbe.json>] [--seuil=<n>] [--voir=<cle,cle>]
// Les deux POLITIQUES de demande, mesurées côte à côte (l'écart est dit, pas lissé) :
//   A (conservatrice, non codée) : le groupe n'est demandé que si l'ensemble fermé de G existe (non nul) et que sa demande + le groupe tiennent dans MESURES_MAX ;
//   B (CELLE DU CODE, calcul-client-route.js) : même quand l'ensemble fermé de G est nul (plus de 12 mesures pour G), le client ne mesure que les zones du groupe.
// Les mots : une ligne est « jugeable » si la vérité est parmi les candidats de la question ; « tête juste » = la tête désignée est la vérité ; « tête fausse » = une autre carte de la question (la vérité y est) ;
// « vérité hors du groupe » = la question ne contenait pas la vérité (toute tête y est fausse, et rien ne pouvait être juste). La tête d'avant n'existe pas : l'ordre servi est par idProduct (CONTRAT-2 §3.1).
const fs = require('fs'), path = require('path');
const GG = require('../identifier/g-groupe');
const MC = require('../identifier/calcul-client');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };

const GRILLE = [1, 5, 10, 20, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 299];
const FAMILLES = ['reglage', 'ordinaires', 'tamponnees'];

/** La décision de production sur une ligne extraite, pour un seuil. null : la ligne n'a pas de groupe demandable sous la politique. */
function decider(l, ecartMin, politique) {
    if (!l || !l.zonesGroupe || !Array.isArray(l.clesChoix)) return null;
    const cleDe = id => { const i = l.choix.indexOf(id); return i >= 0 && l.empruntsChoix[i] === false ? l.clesChoix[i] : null; };
    const groupe = GG.groupeDeLaQuestion(l.choix, cleDe);
    if (!groupe) return { demande: false, motif: 'groupe' };
    const base = l.demande || [];
    if (l.ensembleNul && politique === 'A') return { demande: false, motif: 'ensemble-nul' };
    const ajout = GG.demandeDuGroupe({ groupe, deja: l.ensembleNul ? [] : base, max: MC.MESURES_MAX });
    if (!ajout) return { demande: false, motif: 'demande-trop-grande-ou-visuel-inconnu' };
    const zones = k => (l.zonesGroupe[k] && typeof l.zonesGroupe[k] === 'object' ? l.zonesGroupe[k] : null);
    return { demande: true, ...GG.ordonnerGroupe({ groupe, zones, ecartMin }) };
}

function evaluer(lignes, ecartMin, politique) {
    const T = {};
    for (const f of FAMILLES) T[f] = { lignes: 0, demandees: 0, jugeables: 0, tetes: 0, justes: 0, fausses: 0, veriteHorsGroupe: 0, tetesVeriteHors: 0, motifs: {}, fausseCles: [] };
    for (const l of lignes) {
        const t = T[l.famille]; if (!t) continue;
        t.lignes++;
        const d = decider(l, ecartMin, politique);
        if (!d || !d.demande) { if (d) t.motifs[d.motif] = (t.motifs[d.motif] || 0) + 1; continue; }
        t.demandees++;
        const jugeable = l.verite != null && l.choix.includes(l.verite);
        if (jugeable) t.jugeables++; else if (l.verite != null) t.veriteHorsGroupe++;
        if (!d.change) { t.motifs[d.motif] = (t.motifs[d.motif] || 0) + 1; continue; }
        t.tetes++;
        if (!jugeable) { if (l.verite != null) t.tetesVeriteHors++; continue; }
        if (d.tete === l.verite) t.justes++; else { t.fausses++; t.fausseCles.push(l.cle); }
    }
    return T;
}

function principal() {
    const M = JSON.parse(fs.readFileSync(arg('mesures'), 'utf8'));
    const lignes = M.lignes;
    const etats = {}; for (const l of lignes) { const k = `${l.famille}|${l.etat}`; etats[k] = (etats[k] || 0) + 1; }
    console.log(`lignes à question : ${lignes.length} (index ${M.index}, extrait le ${M.le})`);
    console.log('états par famille :', JSON.stringify(etats));
    const sortie = { le: new Date().toISOString(), index: M.index, etats, courbe: {} };
    for (const politique of ['A', 'B']) {
        console.log(`\n══ POLITIQUE ${politique} ══  (écart minimal en inliers -> par famille : têtes posées / justes / FAUSSES / vérité hors du groupe)`);
        sortie.courbe[politique] = [];
        for (const e of GRILLE) {
            const T = evaluer(lignes, e, politique);
            const ligne = FAMILLES.map(f => `${f.slice(0, 4)} ${T[f].tetes}/${T[f].justes}/${T[f].fausses}/${T[f].tetesVeriteHors}`).join('  |  ');
            console.log(`E=${String(e).padStart(3)}  ${ligne}`);
            sortie.courbe[politique].push({ ecartMin: e, ...Object.fromEntries(FAMILLES.map(f => [f, { tetes: T[f].tetes, justes: T[f].justes, fausses: T[f].fausses, tetesVeriteHors: T[f].tetesVeriteHors, demandees: T[f].demandees, jugeables: T[f].jugeables, fausseCles: T[f].fausseCles }])) });
        }
        const T0 = evaluer(lignes, 100, politique);
        console.log(`dénominateurs à E=100 (${politique}) :`, JSON.stringify(Object.fromEntries(FAMILLES.map(f => [f, { lignes: T0[f].lignes, demandees: T0[f].demandees, jugeables: T0[f].jugeables, veriteHorsGroupe: T0[f].veriteHorsGroupe, motifs: T0[f].motifs }]))));
    }
    // le seuil choisi sur le RÉGLAGE seul : le plus petit de la grille sans tête fausse au réglage (politique B, celle du code)
    const sansFauxReglage = sortie.courbe.B.filter(p => p.reglage.fausses === 0 && p.reglage.tetesVeriteHors === 0);
    const choisi = sansFauxReglage.length ? sansFauxReglage[0].ecartMin : null;
    sortie.seuilChoisiSurLeReglage = choisi;
    console.log(`\nSEUIL choisi sur le réglage seul (le plus petit sans tête fausse ni tête sur vérité hors du groupe, politique B) : ${choisi}`);
    if (arg('seuil')) {
        const e = Number(arg('seuil'));
        for (const politique of ['A', 'B']) { const T = evaluer(lignes, e, politique); console.log(`\nDÉTAIL E=${e} politique ${politique} :`, JSON.stringify(Object.fromEntries(FAMILLES.map(f => [f, T[f]])))); }
    }
    if (arg('voir')) {
        for (const cle of arg('voir').split(',')) {
            const l = lignes.find(x => x.cle === cle || x.cle.startsWith(cle)); if (!l) { console.log(cle, 'absent'); continue; }
            for (const politique of ['A', 'B']) console.log(cle, politique, JSON.stringify(decider(l, Number(arg('seuil', choisi || 100)), politique)), 'vérité', l.verite, 'choix', JSON.stringify(l.choix), 'état', l.etat);
        }
    }
    if (arg('sortie')) fs.writeFileSync(arg('sortie'), JSON.stringify(sortie, null, 1));
}

module.exports = { decider, evaluer, GRILLE };
if (require.main === module) principal();
