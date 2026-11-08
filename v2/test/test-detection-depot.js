'use strict';
// Le DEPOT du test de detection (stockage.js, mesure.detection) : liste fermee, aucune valeur libre. Node pur, aucune base ouverte (valider() ne touche pas la base).
const S = require(process.env.RM_STOCKAGE || '../banc-telephone/stockage');   // RM_STOCKAGE : rejouer contre l'ANCIEN stockage (rouge vu)
let ok = 0, ko = 0;
const vrai = (nom, cond, detail) => { if (cond) ok++; else { ko++; console.log(`❌ ${nom}${detail ? ' — ' + detail : ''}`); } };
const detection = (o = {}) => ({ version: 'rm-detection-1', nImages: 12, nIdentiques: 12, nRgb640: 12, nQuads: 12, nCartes: 12, voieCanvas: 9, voiePillow: 3, ecarts: '', empreinteLot: 'a'.repeat(64), msOpencv: 410, msMediane: 85, msTotal: 1100, jsHeapMo: 12.3, jsHeapApresMo: 40.1, wasmHeapMo: 33, erreur: null, ...o });
const doc = (det, mesure = {}) => ({ v: 1, runId: '0123456789abcdef', modeleSha: '0'.repeat(64), ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', isole: true, coeurs: 6, memoireAppareilGo: null, gpuDispo: false, mesure: { moteur: 'wasm', verdict: 'IDENTIQUE', detection: det, ...mesure } });

vrai('1. un depot de detection complet est accepte', S.valider(doc(detection())).ok === true, JSON.stringify(S.valider(doc(detection()))));
vrai('1. des mesures absentes (null) sont permises (iPhone : pas de performance.memory)', S.valider(doc(detection({ jsHeapMo: null, jsHeapApresMo: null, wasmHeapMo: null, empreinteLot: null }))).ok === true);
vrai('1. une erreur nommee (texte court) est permise', S.valider(doc(detection({ erreur: 'opencv non initialise' }), { verdict: 'ERREUR' })).ok === true);
for (const [nom, d] of [
    ['un champ inconnu', detection({ photo: 'x' })], ['un compte hors bornes', detection({ nIdentiques: 101 })], ['un compte non entier', detection({ nQuads: 1.5 })], ['une empreinte non hexadecimale', detection({ empreinteLot: 'Z'.repeat(64) })],
    ['des ecarts trop longs', detection({ ecarts: 'x'.repeat(201) })], ['un texte non ASCII', detection({ erreur: 'é' })], ['une duree negative', detection({ msTotal: -1 })], ['une version trop longue', detection({ version: 'v'.repeat(31) })]]) {
    const v = S.valider(doc(d));
    vrai(`2. refuse : ${nom}`, v.ok === false && /^champ/.test(v.detail), JSON.stringify(v));
}
vrai('3. un objet detection imbrique inconnu est refuse', S.valider(doc({ ...detection(), imbrique: { a: 1 } })).ok === false);
vrai('3. la mesure du modele (sans detection) reste acceptee', S.valider({ ...doc(null), mesure: { moteur: 'wasm', verdict: 'IDENTIQUE' } }).ok === true);
vrai('3. le document reste sous la borne de taille', Buffer.byteLength(JSON.stringify(doc(detection({ ecarts: 'x'.repeat(200) }))), 'utf8') < S.OCTETS_MAX);
console.log(`${ok} assertions passees, ${ko} en echec`);
process.exit(ko ? 1 : 0);
