// node test-mutants-empruntees.js — MUTANTS du lot TAMPONNEES : chaque mutation casse UN comportement ; test-images-empruntees.js doit ÉCHOUER (mutant tué). Le fichier est restauré à l'octet près dans `finally`.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const M = 'collecte-cartes/images-empruntees.js', S = 'poser-images-empruntees.js', B = 'test-images-empruntees.js';
const MUTANTS = [
    { nom: 'WCD : estWCD ne reconnaît plus rien', fichier: M, de: "const estWCD = s => /^wcd/i.test(String(s ?? '').trim());", vers: 'const estWCD = s => false;' },
    { nom: 'WCD : la comparaison devient sensible à la casse', fichier: M, de: '/^wcd/i.test(', vers: '/^WCD/.test(' },
    { nom: 'WCD : les espaces de tête ne sont plus retirés', fichier: M, de: "String(s ?? '').trim()", vers: "String(s ?? '')" },
    { nom: 'périmètre : la liste des Prize Packs inclut la série Quatre', fichier: M, de: "['Five', 'Six', 'Seven', 'Eight', 'Nine']", vers: "['Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']" },
    { nom: 'périmètre : verifierPerimetre ne lève plus sur un slug absent', fichier: M, de: 'if (absents.length) throw', vers: 'if (false) throw' },
    { nom: 'couverture : une entrée du set sans numéro ne couvre plus la ligne', fichier: M, de: 'if (numero == null) return duSet.length > 0;', vers: 'if (numero == null) return false;' },
    { nom: 'couverture : tout numéro couvre (la comparaison de numéro est ignorée)', fichier: M, de: 'cleNumero(e.numero) === cle', vers: 'true' },
    { nom: 'couverture : un numéro inconnu ne couvre plus (la prudence saute)', fichier: M, de: "e.numero == null || String(e.numero).trim() === '' || ", vers: '' },
    { nom: 'tampon : « Play! Pokémon » posé aussi sur Battle Academy et Trick or Trade', fichier: M, de: '(SETS_PRIZE_PACK.includes(s) ? TAMPON_PRIZE_PACK : null)', vers: '(TAMPON_PRIZE_PACK)' },
    { nom: 'entrée : imageEmprunteeTirage vaut faux', fichier: M, de: "lot: LOT, imageEmprunteeTirage: true });", vers: "lot: LOT, imageEmprunteeTirage: false });" },
    { nom: 'entrée : la vignette de l\'origine n\'est plus reprise', fichier: M, de: 'if (origine) entree.vignette', vers: 'if (false) entree.vignette' },
    { nom: 'plan : des substituts divergents ne sont plus refusés', fichier: M, de: 'if (g.sub.cleR2 !== sub.cleR2 || g.sub.w !== sub.w || g.sub.h !== sub.h) g.diverge = true;', vers: '' },
    { nom: 'plan : une ligne sans carteId > 0 est traitée', fichier: M, de: 'if (!entier(l.carteId)) {', vers: 'if (false) {' },
    { nom: 'plan : un substitut sans cleR2 est accepté', fichier: M, de: "const aSubstitut = !!sub && typeof sub.cleR2 === 'string' && !!sub.cleR2;", vers: 'const aSubstitut = !!sub;' },
    { nom: 'écriture : le $push n\'est plus gardé par $not/$elemMatch', fichier: M, de: 'filter: { _id: a.carteId, images: { $not:', vers: 'filter: { _id: a.carteId, images0: { $not:' },
    { nom: 'retrait : le $pull ne borne plus par le lot', fichier: M, de: 'source: SOURCE, lot: LOT, imageEmprunteeTirage: true, numero: o.numero ?? null', vers: 'source: SOURCE, imageEmprunteeTirage: true, numero: o.numero ?? null' },
    { nom: 'retrait : le retrait en mémoire ignore la source', fichier: M, de: 'e.source === SOURCE && e.lot === LOT &&', vers: '' },
    { nom: 'manifeste : un plan vide écrase le manifeste plein', fichier: M, de: 'totalManifeste(existant) > 0 && totalManifeste(nouveau) === 0', vers: 'false' },
    { nom: 'lot-additif : --ecrire accepté hors lot', fichier: M, de: "env.LOT_ADDITIF_PID !== String(ppid)) throw", vers: 'false) throw' },
    { nom: 'script : --ecrire sans --attendu accepté', fichier: S, de: 'if (ECRIRE && !ATTENDU) {', vers: 'if (false) {' },
    { nom: 'script : l\'argument inconnu passe', fichier: S, de: 'if (inconnus.length) {', vers: 'if (false) {' },
    { nom: 'script : la garde « hors lot-additif » saute', fichier: S, de: 'if (ECRIRE) { try { E.garderSousLot', vers: 'if (false) { try { E.garderSousLot' },
    { nom: 'correction 1 : la condition source === \'emprunt\' est retirée', fichier: 'collecte-cartes/basse-definition.js', de: "e && e.source === 'emprunt' && e.imageEmprunteeTirage === true) {", vers: 'e && e.imageEmprunteeTirage === true) {' },
    { nom: 'correction 1 : la condition imageEmprunteeTirage === true est retirée', fichier: 'collecte-cartes/basse-definition.js', de: "e && e.source === 'emprunt' && e.imageEmprunteeTirage === true) {", vers: "e && e.source === 'emprunt') {" },
    { nom: 'correction 1 : toute entrée sans document devient lisible', fichier: 'collecte-cartes/basse-definition.js', de: "e && e.source === 'emprunt' && e.imageEmprunteeTirage === true) {", vers: 'true) {' },
    { nom: 'écriture : le nombre d\'écritures n\'est plus comparé à --attendu', fichier: M, de: 'if (nbOperations !== attendu) return', vers: 'if (false) return' },
    { nom: 'écriture : un refus au plan n\'arrête plus l\'écriture', fichier: M, de: 'if (nbRefus) return', vers: 'if (false) return' },
    { nom: 'script : le motif d\'arrêt n\'est plus appelé avant l\'écriture', fichier: S, de: 'if (arret) {', vers: 'if (false) {' },
    { nom: 'correction 2 : le premier produit d\'origine devient le dernier', fichier: M, de: "ids[1].split('/')[0]", vers: "ids[1].split('/').pop()" },
    { nom: 'correction 2 : la langue « en » n\'est plus exigée', fichier: M, de: "e.set === setOrigine && e.langue === 'en' && ", vers: 'e.set === setOrigine && ' },
    { nom: 'correction 2 : plusieurs entrées d\'origine acceptées', fichier: M, de: 'if (trouvees.length !== 1) return', vers: 'if (trouvees.length < 1) return' },
    { nom: 'correction 2 : un nom de set ambigu est accepté', fichier: M, de: 'if (ids.length !== 1) return { refus: `Trick or Trade : le nom', vers: 'if (ids.length < 1) return { refus: `Trick or Trade : le nom' },
    { nom: 'correction 2 : le nomAffichage ne prime plus sur nomEn', fichier: M, de: 'const ids = parAffichage.length ? parAffichage : (etat.setsParNom?.get(o.nomSet) || []);', vers: 'const ids = etat.setsParNom?.get(o.nomSet) || [];' },
    { nom: 'correction 2 : tout set sans substitut dérive de son origine (PP, BA aussi)', fichier: M, de: '!aSubstitut && derivableDeLOrigine(set, idProduct);', vers: '!aSubstitut && true;' },
    // ── PHASE 3b (T4) : Southeast-Asia-Promos borné à 3 produits
    { nom: 'SEA : la liste fermée admet tout produit du set', fichier: M, de: 'SETS_BORNES, s) && SETS_BORNES[s].includes(idProduct)) || origineExplicite', vers: 'SETS_BORNES, s)) || origineExplicite' },
    // ── API-52 L1 : origine explicite
    { nom: 'L1 : un produit de CLK/CLF hors liste est admis', fichier: M, de: '|| origineExplicite(s, idProduct) !== null;', vers: '|| setExplicite(s);' },
    { nom: 'L1 : l\'origine explicite se dérive aussi du detail (derivableDeLOrigine)', fichier: M, de: '(Object.prototype.hasOwnProperty.call(SETS_BORNES, s) && SETS_BORNES[s].includes(idProduct)));', vers: '(estBorne(s, idProduct)));' },
    { nom: 'L1 : la carte de la ligne n\'est plus comparée à celle de l\'origine', fichier: M, de: 'if (l.carteId !== o.carteId) return', vers: 'if (false) return' },
    { nom: 'L1 : plusieurs entrées d\'origine acceptées', fichier: M, de: 'if (trouvees.length !== 1) return { refus: `origine explicite', vers: 'if (trouvees.length < 1) return { refus: `origine explicite' },
    { nom: 'L1 : la clé d\'origine n\'est plus exigée', fichier: M, de: 'e.set === o.setOrigine && e.cleR2 === o.cleR2 && ', vers: 'e.set === o.setOrigine && ' },
    { nom: 'L1 : le numéro d\'origine n\'est plus exigé', fichier: M, de: ' && cleNumero(e.numero) === cle);\n    if (trouvees.length !== 1) return { refus: `origine explicite', vers: ');\n    if (trouvees.length !== 1) return { refus: `origine explicite' },
    { nom: 'L1 : la langue est de nouveau « en » en dur', fichier: M, de: 'langue: g.sub.langue ?? \'en\'', vers: "langue: 'en'" },
    { nom: 'L1 : un set à origine explicite n\'est plus exigé en base', fichier: M, de: ', ...Object.keys(ORIGINES_EXPLICITES)].filter(s => !ids.has(s))', vers: '].filter(s => !ids.has(s))' },
    { nom: 'L1 : le frère hors liste ne bloque plus un set à origine explicite', fichier: M, de: 'if (setBorne(g.set)) {', vers: 'if (Object.prototype.hasOwnProperty.call(SETS_BORNES, g.set)) {' },
    { nom: 'SEA : le set entier entre dans le périmètre', fichier: M, de: '...SETS_TRICK_OR_TRADE]);\n\n// PHASE 3b', vers: "...SETS_TRICK_OR_TRADE, 'Southeast-Asia-Promos']);\n\n// PHASE 3b" },
    { nom: 'SEA : la liste fermée porte un 8e produit', fichier: M, de: '850142, 833720, 855687, 819263])', vers: '850142, 833720, 855687, 819263, 901075])' },
    { nom: 'SEA : la liste fermée perd un frère', fichier: M, de: '850142, 833720, 855687, 819263])', vers: '850142, 833720, 855687])' },
    // ── TOUR 1 (24/10) : D4.1 la mention SERVIE, D4.2 --ecrire exige --sets
    { nom: 'D4.1 : la mention « réelle » rejoue l\'ancien appel (sans le set de la fiche)', fichier: M, de: 'reelle: mentionDuVisuelEmprunte(imageServieDe(images, url, set))', vers: 'reelle: mentionDuVisuelEmprunte(imageServieDe(images, url))' },
    { nom: 'D4.1 : un produit sans mention n\'est plus nommé', fichier: M, de: 'filter(id => !mentionDe(a.carteId, a.set, id))', vers: 'filter(id => false)' },
    { nom: 'D4.1 : le script n\'arrête plus sur un produit sans mention', fichier: S, de: 'if (sansMention.length) { console.error', vers: 'if (false) { console.error' },
    { nom: 'D4.1 : le script rejoue la mention sans le set', fichier: S, de: "set, imageServieDe: T.imageServieDe, mentionDuVisuelEmprunte: T.mentionDuVisuelEmprunte }).reelle; };", vers: "set: null, imageServieDe: T.imageServieDe, mentionDuVisuelEmprunte: T.mentionDuVisuelEmprunte }).reelle; };" },
    { nom: 'D4.2 : --ecrire accepté sans --sets', fichier: S, de: 'if (ECRIRE && SELECTION === null) {', vers: 'if (false) {' },
    { nom: 'D4.2 : le manifeste ne porte plus la sélection', fichier: M, de: "sets: sets === null ? null : [...sets],", vers: 'sets: null,' },
    { nom: 'D4.2 : memeSelection accepte une sélection différente', fichier: M, de: "return JSON.stringify([...manifestePose.sets].sort()) === JSON.stringify([...sets].sort());", vers: 'return true;' },
    { nom: 'D4.2 : memeSelection accepte un manifeste sans sélection', fichier: M, de: 'if (!manifestePose || !Array.isArray(manifestePose.sets) || !Array.isArray(sets)) return false;', vers: 'if (!manifestePose || !Array.isArray(sets)) return false; if (!Array.isArray(manifestePose.sets)) return true;' },
    { nom: 'D4.2 : l\'écriture ne compare plus la sélection du manifeste', fichier: S, de: 'if (simule !== null && !E.memeSelection(JSON.parse(simule), SELECTION)) {', vers: 'if (false) {' },
    { nom: 'D4.2 : le retrait ne compare plus la sélection du manifeste', fichier: S, de: 'if (ECRIRE && !E.memeSelection(m, SELECTION)) {', vers: 'if (false) {' },
    // (mutant ÉQUIVALENT écarté : `dansLeChamp` sans `!estWCD` — un slug WCD n'est ni dans PERIMETRE ni dans SETS_BORNES ; la garde nommée est une ceinture de plus, testée par estWCD / refusWCD plus haut)
    { nom: 'SEA : une ligne hors liste est comptée hors périmètre au lieu de hors liste', fichier: M, de: 'if (setBorne(set)) plan.horsListe++; else plan.horsPerimetre++;', vers: 'plan.horsPerimetre++;' },
    { nom: 'SEA : la dérivation depuis l\'origine ne vaut plus pour la liste fermée', fichier: M, de: '(SETS_TRICK_OR_TRADE.includes(s) || (Object.prototype.hasOwnProperty.call(SETS_BORNES, s) && SETS_BORNES[s].includes(idProduct)));', vers: 'SETS_TRICK_OR_TRADE.includes(s);' },
    { nom: 'SEA : les produits hors champ ne sont plus nommés', fichier: M, de: '.filter(id => !dansLeChamp(a.set, id))', vers: '.filter(id => false)' },
    { nom: 'SEA : verifierBornes ne lève plus', fichier: M, de: 'if (absents.length) throw new Error(`sets à liste fermée', vers: 'if (false) throw new Error(`sets à liste fermée' },
    { nom: 'SEA : le script ne lit plus les sets à liste fermée', fichier: S, de: "{ _id: { $in: [...E.SETS_LUS] } }", vers: "{ _id: { $in: [...E.PERIMETRE] } }" },
    { nom: 'SEA : le script ne lit plus l\'origine des produits de la liste', fichier: S, de: 'E.derivableDeLOrigine(l.slugSet, l.idProduct) && !l.visuelSubstitut', vers: 'E.SETS_TRICK_OR_TRADE.includes(l.slugSet) && !l.visuelSubstitut' },
    { nom: 'SEA : un plan hors champ n\'arrête plus le script', fichier: S, de: 'if (horsChamp.length) {', vers: 'if (false) {' },
    { nom: 'SEA : un frère hors liste (même carte, même set) n\'arrête plus l\'entrée', fichier: M, de: 'if (freres.length) { plan.refus.push', vers: 'if (false) { plan.refus.push' },
    { nom: 'SEA : le frère est cherché dans toutes les cartes (pas seulement la même)', fichier: M, de: 'l.carteId === g.carteId && l.slugSet === g.set && !estBorne', vers: 'l.slugSet === g.set && !estBorne' },
    { nom: 'SEA : le frère est cherché dans tous les sets de la carte', fichier: M, de: 'l.carteId === g.carteId && l.slugSet === g.set && !estBorne', vers: 'l.carteId === g.carteId && !estBorne' },
    { nom: '--sets : la sélection ne restreint plus le plan', fichier: M, de: 'if (sets !== null && !sets.includes(set)) { plan.horsSelection++; continue; }', vers: '' },
    { nom: '--sets : une sélection vide est acceptée', fichier: M, de: "if (!Array.isArray(sets) || !sets.length) throw", vers: 'if (!Array.isArray(sets)) throw' },
    { nom: '--sets : un set hors du champ de lecture est accepté', fichier: M, de: 'if (inconnus.length) throw new Error(`sélection de sets hors', vers: 'if (false) throw new Error(`sélection de sets hors' },
    { nom: '--sets : un doublon est accepté', fichier: M, de: 'if (doublons.length) throw', vers: 'if (false) throw' },
    { nom: '--sets : la relecture après écriture ne reçoit plus la sélection', fichier: S, de: 'const relu = E.planifier(await lireEtat(cx.dbCartes), { sets: SELECTION });', vers: 'const relu = E.planifier(await lireEtat(cx.dbCartes));' },
    { nom: '--sets : le script ne valide plus la sélection avant la connexion', fichier: S, de: 'try { E.verifierSelection(SELECTION); }', vers: 'try { }' },
    { nom: 'SEA : un autre produit perdu côté API passe', fichier: M, de: "if (horsPlan.length || cmp.autresPerdus.length) raisons.push", vers: 'if (false) raisons.push' },
    { nom: 'SEA : un produit changé côté API passe', fichier: M, de: 'if (cmp.changes.length) raisons.push', vers: 'if (false) raisons.push' },
    { nom: 'SEA : un produit gagné côté API passe', fichier: M, de: 'if (cmp.gagnes.length) raisons.push', vers: 'if (false) raisons.push' },
    { nom: 'SEA : un refus nouveau du contrat passe', fichier: M, de: 'if (contratNouveaux > 0) raisons.push', vers: 'if (false) raisons.push' },
    { nom: 'SEA : le script n\'applique plus le verdict de l\'API', fichier: S, de: 'if (!vApi.ok) {', vers: 'if (false) {' },
    { nom: 'correction 2 : la dérivation n\'a jamais lieu', fichier: M, de: "if (depuisOrigine) { const d = substitutDepuisOrigine(l, c, etat);", vers: "if (false) { const d = substitutDepuisOrigine(l, c, etat);" },
    { nom: 'correction 2 : la mention « si correctif » ne filtre plus sur le set', fichier: M, de: "(images || []).filter(e => e && e.set === set)", vers: '(images || [])' },
    { nom: 'correction 2 : le retrait partiel affiche ✅', fichier: S, de: "touches === ops.length ? '✅' : '⚠️ retrait PARTIEL —'", vers: "true ? '✅' : '⚠️ retrait PARTIEL —'" },
    { nom: 'correction 2 : la lecture des WCD redevient sensible à la casse', fichier: S, de: '{ slugSet: /^wcd/i }', vers: '{ slugSet: /^WCD/ }' },
];

let tues = 0, survivants = [];
for (const m of MUTANTS) {
    const chemin = path.join(__dirname, m.fichier);
    const original = fs.readFileSync(chemin);
    const src = original.toString('utf8').replace(/\r\n/g, '\n');
    try {
        if (!src.includes(m.de)) { survivants.push(`${m.nom} : MOTIF INTROUVABLE (le mutant n'a rien muté)`); console.log(`❓ MOTIF INTROUVABLE : ${m.nom}`); continue; }
        fs.writeFileSync(chemin, src.replace(m.de, () => m.vers));
        const r = spawnSync(process.execPath, [path.join(__dirname, B)], { encoding: 'utf8', timeout: 120000, env: process.env });
        if (r.status !== 0) { tues++; console.log(`☠️  tué : ${m.nom}`); }
        else { survivants.push(m.nom); console.log(`🧟 SURVIVANT : ${m.nom}`); }
    } finally { fs.writeFileSync(chemin, original); }
}
console.log(`\nmutants : ${tues} tués sur ${MUTANTS.length}${survivants.length ? ' — survivants : ' + survivants.join(' ; ') : ''}`);
process.exit(survivants.length ? 1 : 0);
