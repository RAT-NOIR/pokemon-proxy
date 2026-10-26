'use strict';
// LOT FUITE-INLIERS — la pente mémoire de inliers() : sur 1 500 tours (3 000 appels), la mémoire WASM ne croît PAS d'un octet après la chauffe et AUCUN objet C++ ne reste vivant.
// Le banc long (5 000 appels et plus, RSS compris) se lance à la main : node v2/mesures/mesurer-fuite-inliers.js. Les mutants (un `.delete()` retiré) : node v2/mesures/muter-fuite-inliers.js.
// FUITE_INLIERS_MODULE (réservé au lanceur de mutants) : le module departage-image à juger à la place de celui du dépôt.
// Cartes FABRIQUÉES (graine fixe) : aucun fichier, aucun réseau, aucune base. Les nombres d'inliers sont ceux du code d'AVANT le lot MEMOIRE-G (c7280b8e/342dc544) : libérer ne change aucune mesure.
const V = require('./_embind-vivants').armer();       // AVANT tout require d'opencv
const H = require('./_harnais');
const P = require('../mesures/pente-inliers');
const D = require(process.env.FUITE_INLIERS_MODULE || '../../departage-image');

const JEU_FIXE_AVANT = [150, 118, 5, 4, 7, 107, 150, 5, 5, 5, 1, 6, 150, 0, 8, 4, 0, 7, 150, 0, 6, 8, 5, 6, 150];   // relevé sur le code de 342dc544 (avant MEMOIRE-G), Node 24 — identique au code actuel

(async () => {
    const r = await P.mesurer({ D, appels: 1500, pas: 500, dossier: null });
    const fin = r.fin, ch = r.chauffe;
    console.log(`   WASM ${ch.wasm} → ${fin.wasm} octets (appels ${ch.appels} → ${fin.appels}), vivants ${ch.vivants} → ${fin.vivants}, RSS ${Math.round(ch.rss / 1048576)} → ${Math.round(fin.rss / 1048576)} Mo (pour mémoire)`);
    H.vrai('1. la mémoire WASM est mesurable (opencv instancié)', ch.wasm > 0);
    H.v(`2. mémoire WASM : croissance de ${P.BORNE_WASM_OCTETS} octet après la chauffe (${P.CHAUFFE} tours), sur 1 400 tours (mesuré : l'ancien code ne la fait pas bouger, même à 6 000 appels — ses copies tiennent dans les 128 Mo préalloués ; la fuite d'origine est dans le COMPTE d'objets et le tas JS)`, r.croissanceWasmOctets <= P.BORNE_WASM_OCTETS, true);
    H.v('3. aucun objet C++ vivant à aucun relevé après la chauffe (la mesure exacte : l\'ancien code en laisse 300 par tour)', r.vivantsMax <= P.BORNE_VIVANTS, true);
    const jeu = await P.inliersDuJeuFixe(D);
    console.log(`   jeu fixe (5 cartes, 25 paires ordonnées) : ${JSON.stringify(jeu)}`);
    H.v('4. les inliers ne changent pas : les 25 paires du jeu fixe rendent les nombres du code d\'avant MEMOIRE-G (342dc544)', jeu, JEU_FIXE_AVANT);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
