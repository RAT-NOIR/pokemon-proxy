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
    { nom: 'correction 2 : tout set sans substitut dérive de son origine (PP, BA aussi)', fichier: M, de: '!aSubstitut && SETS_TRICK_OR_TRADE.includes(set);', vers: '!aSubstitut && true;' },
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
