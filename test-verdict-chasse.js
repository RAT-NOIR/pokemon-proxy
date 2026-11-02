'use strict';
// Banc du verdict de chasse (méthode des 8 requêtes). Pur : aucune base, aucun réseau.
const assert = require('assert');
const { juger, jugerFichier, LANGUES, MIN_REQUETES, MIN_LANGUES } = require('./collecte-cartes/verdict-chasse');

let ok = 0, ko = 0;
function t(nom, f) { try { f(); ok++; } catch (e) { ko++; console.log('ECHEC ' + nom + ' : ' + e.message); } }

const LS = ['en', 'ja', 'zh-hans', 'zh-hant', 'id', 'th', 'ko', 'fr'];
function reqs(n, nLangues) {
  return Array.from({ length: n }, (_, i) => ({
    texte: 'requete numero ' + i, langue: LS[i % nLangues], resultatsOuverts: ['https://exemple.test/' + i],
  }));
}
const ext = (o) => Object.assign({ code: 'X1', set: 'Exemple', verdict: 'introuvable', requetes: reqs(8, 3) }, o);
const refus = (e, motif) => { const r = juger(e); assert.strictEqual(r.accepte, false, 'devait etre refuse'); assert(r.motifs.join(' | ').includes(motif), 'motif attendu "' + motif + '", obtenu : ' + r.motifs.join(' | ')); };

t('constantes', () => { assert.strictEqual(MIN_REQUETES, 8); assert.strictEqual(MIN_LANGUES, 3); assert(LANGUES.includes('zh-hans')); });
t('8 requetes / 3 langues : accepte', () => assert.strictEqual(juger(ext()).accepte, true));
t('7 requetes : refuse', () => refus(ext({ requetes: reqs(7, 3) }), '7 requêtes / 8'));
t('8 requetes en 2 langues : refuse', () => refus(ext({ requetes: reqs(8, 2) }), '2 langues / 3'));
t('doublons ramenant sous 8 : refuse', () => {
  const r = reqs(8, 3); r[7].texte = '  REQUETE   numero 0 ';
  refus(ext({ requetes: r }), 'requêtes en double');
});
t('langue inconnue : refuse', () => {
  const r = reqs(8, 3); r[0].langue = 'klingon';
  refus(ext({ requetes: r }), 'langue hors liste');
});
t('requete vide : refuse', () => {
  const r = reqs(9, 3); r[0].texte = '   ';
  refus(ext({ requetes: r }), 'requête vide');
});
t('requete sans langue : refuse', () => {
  const r = reqs(9, 3); delete r[1].langue;
  refus(ext({ requetes: r }), 'langue hors liste');
});
t('requetes absentes : refuse', () => refus(ext({ requetes: undefined }), '0 requêtes / 8'));
t('trouve sans source : refuse', () => refus(ext({ verdict: 'trouve', requetes: [], sources: [] }), 'sans source'));
t('trouve sans champ sources : refuse', () => refus(ext({ verdict: 'trouve', requetes: [] }), 'sans source'));
t('trouve avec source : accepte', () => assert.strictEqual(juger(ext({ verdict: 'trouve', requetes: [], sources: ['https://s.test/a'] })).accepte, true));
t('verdict inconnu : refuse', () => refus(ext({ verdict: 'peut-etre' }), 'verdict inconnu'));
t('code absent : refuse', () => refus(ext({ code: '' }), 'code manquant'));
t('fichier sans extensions : refuse', () => { const r = jugerFichier({}); assert.strictEqual(r.accepte, false); assert(r.motifs[0].includes('extensions')); });
t('fichier extensions vide : refuse', () => assert.strictEqual(jugerFichier({ extensions: [] }).accepte, false));
t('fichier non objet : refuse', () => assert.strictEqual(jugerFichier(null).accepte, false));
t('extension non objet : refuse', () => assert.strictEqual(jugerFichier({ extensions: [null] }).accepte, false));
t('fichier : denominateur et refus propages', () => {
  const r = jugerFichier({ extensions: [ext(), ext({ code: 'X2', requetes: reqs(5, 3) })] });
  assert.strictEqual(r.total, 2); assert.strictEqual(r.acceptes, 1); assert.strictEqual(r.accepte, false);
});
t('fichier tout bon : accepte', () => assert.strictEqual(jugerFichier({ extensions: [ext(), ext({ code: 'X2' })] }).accepte, true));
t('introuvable avec langues en doublon de casse', () => {
  const r = reqs(8, 3).map((q) => Object.assign({}, q, { langue: q.langue.toUpperCase() }));
  refus(ext({ requetes: r }), 'langue hors liste');
});

console.log(ok + ' passes, ' + ko + ' en echec');
process.exit(ko ? 1 : 0);
