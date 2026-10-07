// ============================================================================
// RATMARKET V1 — LA RÈGLE DE DÉCISION G, PORTÉE DANS L'API (feu vert du testeur, 2026-10-06 : « 29 affirmés au réel contre 24, 0 faux
// même vérité retirée »)
// ============================================================================
// Transposition ligne à ligne de pokemon-proxy-labo/rm/decider.py (fonction `decider`, réglage G). Rien n'est réinventé ici : la règle
// a été CALIBRÉE au labo (vérité cachée, une moitié de l'auto-banc pour choisir, l'autre moitié, le banc réel et la famille Dracaufeu pour
// juger) ; ce module doit rendre les MÊMES décisions sur les mêmes entrées. Banc : ratmarket/test-decision-g.js rejoue les décisions du
// labo avec les mesures de zones que le labo a lui-même faites (rm/exporter_fixtures_g.py) — la règle se juge seule ; la garde des zones
// en OpenCV.js se mesure à part.
//
// LA RÈGLE G, en clair :
//   1. le PREMIER voisin désigne un visuel ; ses CONCURRENTS sont ses jumeaux (même groupe de dessin) parmi les 10 voisins, et tout
//      voisin à moins de `delta` de lui ;
//   2. avec des concurrents, la photo redressée est comparée aux deux scans de chaque paire SUR LES PIXELS OÙ ILS DIFFÈRENT (la carte des
//      différences) : le gagnant doit battre chaque rival d'au moins `marge_zone` ;
//   3. la ZONE CLÉ (le bas : numéro, code ; le haut : nom) ne juge que là où un VRAI jumeau existe — un membre du groupe, ou une
//      impression de la carte sans visuel ; là, similarité et marge à une autre carte valent aussi (`planchers_partout`) ;
//   4. LE RESTE : si la carte retenue, ou un frère de son groupe, a une impression SANS visuel, on n'affirme pas (une photo de cette
//      impression ressemblerait à ce visuel, rien ne peut l'exclure) ;
//   5. du visuel au produit : un produit → affirmé ; plusieurs au même prix → réponse commune ; sinon une question.
// 0 faux affirmé est non négociable : une affirmation fausse coûte plus cher qu'une question.
'use strict';

// le réglage G, tel que le fichier de décisions du labo l'écrit (decisions-rm2213-p8000-G-*.json, « seuils »)
const SEUILS_G = Object.freeze({ delta: 0.03, marge_carte: 0.2, marge_zone: 0.06, tau_bas: 0.7, tau_haut: 0.55, inliers_min: 40,
    invisibles: true, zone_cle_si: 'jumeaux', sim_min: 0, planchers_partout: true });

/** Le contexte que la décision lit, construit depuis contexte.json du labo (ou son équivalent servi en production). */
function contexte({ groupe, carte, invisibles, produits }) {
    const g = new Map(Object.entries(groupe));
    // les MEMBRES de chaque groupe, dans l'ordre où le labo les range (l'ordre d'insertion de `groupe`)
    const membres = new Map();
    for (const [c, k] of g) { if (!membres.has(k)) membres.set(k, []); membres.get(k).push(c); }
    return {
        groupe: g, membres,
        carte: new Map(Object.entries(carte).map(([k, v]) => [k, new Set(v.map(Number))])),
        invisibles: new Map(Object.entries(invisibles).map(([k, v]) => [Number(k), v])),
        produits: new Map(Object.entries(produits))
    };
}

const f3 = x => (Math.round(x * 1000) / 1000).toFixed(3);
const croise = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
const unique = arr => [...new Set(arr)];

/**
 * @param ctx      contexte()
 * @param ligne    { top: [[cle, similarite] × 10], essai } — essai : l'indice de l'essai retenu (0 = la photo entière)
 * @param nEssais  le nombre d'essais de la requête (photo entière + cartes redressées)
 * @param mesures  { comparerPaire(a, b) → [ecart, couverture], scoresZones(visuel) → { haut, bas, inliers, … } } — la garde des zones,
 *                 sur la carte redressée retenue (celle que la décision désigne : l'essai, ou à défaut le premier redressé)
 * @param S        les seuils (SEUILS_G par défaut)
 */
function decider(ctx, ligne, nEssais, mesures, S = SEUILS_G) {
    const top = ligne.top;
    const [k1, s1Premier] = top[0];
    let s1 = s1Premier;
    const cartes = k => ctx.carte.get(k) || new Set();
    const g1 = ctx.groupe.has(k1) ? ctx.groupe.get(k1) : undefined;
    const conc = top.slice(1).filter(([k, s]) => (g1 !== undefined && ctx.groupe.get(k) === g1) || s1 - s < S.delta).map(([k]) => k);
    const autre = top.slice(1).find(([k]) => !croise(cartes(k), cartes(k1)));
    let marge = autre ? s1 - autre[1] : 1.0;
    const info = { premier: k1, concurrents: conc, margeCarte: Math.round(marge * 1e4) / 1e4 };
    const essaiRedresse = ligne.essai > 0 ? ligne.essai : (nEssais > 1 ? 1 : null);
    let visuel;
    if (!conc.length) {
        if (marge < S.marge_carte) return { affirme: false, raison: `marge carte ${f3(marge)} < ${S.marge_carte}`, ...info };
        visuel = k1;
    } else {
        if (essaiRedresse === null) return { affirme: false, raison: 'aucune carte redressée : la garde des zones ne peut pas regarder', ...info };
        let gagnant = k1; const details = [];
        for (const t of conc.slice(0, 4)) {
            const [d, couv] = mesures.comparerPaire(gagnant, t);
            if (d <= -S.marge_zone) gagnant = t;          // le concurrent gagne nettement : il devient le candidat, et doit battre les autres
            details.push([t, d, couv]);
        }
        info.zones = details; info.gagnant = gagnant;
        // le gagnant doit battre CHAQUE concurrent (y compris l'ancien premier) ; une paire sans différence mesurable ne se tranche pas
        for (const t of [k1, ...conc.slice(0, 4)].filter(x => x !== gagnant)) {
            const [d, couv] = mesures.comparerPaire(gagnant, t);
            if (couv === 0 || d < S.marge_zone) return { affirme: false, raison: `carte des différences : ${gagnant} ne bat pas ${t} (${f3(d)}, masque ${f3(couv)})`, ...info };
        }
        visuel = gagnant;
    }
    // LA ZONE CLÉ, seulement entre vrais jumeaux (zone_cle_si 'jumeaux') : un membre du groupe, ou une impression de la carte sans visuel
    let vraisJumeaux = conc.filter(k => g1 !== undefined && ctx.groupe.get(k) === g1);
    let invVisuel = [...cartes(visuel)].flatMap(c => ctx.invisibles.get(c) || []);
    const modeJumeaux = (S.zone_cle_si || 'toujours') === 'jumeaux';
    if (modeJumeaux) {
        const gv = ctx.groupe.has(visuel) ? ctx.groupe.get(visuel) : undefined;
        const freres = gv !== undefined ? (ctx.membres.get(gv) || []).filter(k => k !== visuel) : [];
        vraisJumeaux = unique([...vraisJumeaux, ...freres]);
        invVisuel = unique([...invVisuel, ...freres.flatMap(k => [...cartes(k)].flatMap(c => ctx.invisibles.get(c) || []))]);
        info.restesDuGroupe = invVisuel.length;
        // la similarité et la marge du visuel RETENU (un concurrent gagnant par les zones a son propre score)
        const sv = top.find(([k]) => k === visuel); if (sv) s1 = sv[1];
        const autreV = top.find(([k]) => !croise(cartes(k), cartes(visuel)));
        marge = autreV ? s1 - autreV[1] : 1.0;
    }
    const jugeZone = !modeJumeaux || vraisJumeaux.length > 0 || invVisuel.length > 0;
    info.zoneCleJuge = jugeZone;
    if (S.planchers_partout && jugeZone) {
        if (s1 < (S.sim_min || 0)) return { affirme: false, raison: `similarité ${f3(s1)} < ${S.sim_min} (le reste ?)`, ...info, visuel };
        if (marge < S.marge_carte) return { affirme: false, raison: `marge carte ${f3(marge)} < ${S.marge_carte}`, ...info, visuel };
    }
    if (!jugeZone) {
        if (s1 < (S.sim_min || 0)) return { affirme: false, raison: `sans jumeau : similarité ${f3(s1)} < ${S.sim_min} (le reste ?)`, ...info, visuel };
        if (marge < S.marge_carte) return { affirme: false, raison: `sans jumeau : marge carte ${f3(marge)} < ${S.marge_carte}`, ...info, visuel };
    }
    if (S.tau_bas !== null && S.tau_bas !== undefined && jugeZone) {
        if (essaiRedresse === null) return { affirme: false, raison: 'aucune carte redressée : la zone clé ne peut pas confirmer', ...info, visuel };
        const z = mesures.scoresZones(visuel);
        info.zonesVisuel = z;
        if (z.bas < S.tau_bas || z.haut < S.tau_haut || z.inliers < (S.inliers_min ?? 40))
            return { affirme: false, raison: `la zone clé ne confirme pas (bas ${z.bas.toFixed(2)}, haut ${z.haut.toFixed(2)}, ${z.inliers} points)`, ...info, visuel };
    }
    const prods = ctx.produits.get(visuel) || [];
    info.visuel = visuel;
    // LE RESTE (§8) : la carte, ou un frère de son groupe, a des impressions SANS visuel — rien ne peut les exclure
    const inv = modeJumeaux ? invVisuel : [...cartes(visuel)].flatMap(c => ctx.invisibles.get(c) || []);
    if (inv.length && S.invisibles !== false)
        return { affirme: false, raison: `la carte a ${inv.length} produit(s) sans visuel : l'image ne peut pas les exclure`, question: [...prods.map(([i]) => i).slice(0, 2), ...inv.slice(0, 1)], ...info };
    if (!prods.length) return { affirme: false, raison: 'le visuel n\'a pas de produit', ...info };
    if (prods.length === 1) return { affirme: true, produit: prods[0][0], raison: 'un visuel, un produit', ...info };
    const prix = prods.map(([, p]) => p);
    if (prix.every(p => p !== null && p !== undefined) && Math.max(...prix) - Math.min(...prix) <= Math.max(0.25, 0.10 * Math.max(...prix)))
        return { affirme: false, reponseCommune: prods.map(([i]) => i), raison: `${prods.length} produits au même visuel, même prix`, ...info };
    return { affirme: false, raison: `${prods.length} produits au même visuel, prix différents : question en images`, question: prods.map(([i]) => i).slice(0, 3), ...info };
}

/** juste / FAUX / commune-juste / commune-FAUSSE / question — le jugement du labo (decider.juger). */
function juger(d, veriteProduits) {
    const v = new Set(veriteProduits);
    if (d.affirme) return v.has(d.produit) ? 'juste' : 'FAUX';
    if (d.reponseCommune) return d.reponseCommune.some(i => v.has(i)) ? 'commune-juste' : 'commune-FAUSSE';
    return 'question';
}

module.exports = { SEUILS_G, contexte, decider, juger };
