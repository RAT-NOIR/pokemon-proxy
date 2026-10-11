'use strict';
// COTES-VISUELS — la graine des visuels pour les bancs : les visuels vivent EN MÉMOIRE (v2/chargeur), plus dans une collection. Un banc construit une version avec le MÊME constructeur que le
// chargeur (donc la même validation lireEntree), l'INSTALLE dans son processus et, pour un serveur enfant, l'écrit en archive locale (V2_VISUELS_BANC_FICHIER, honorée en mode banc seulement).
const fs = require('fs'); const os = require('os'); const path = require('path'); const zlib = require('zlib');
const F = require('../chargeur/format'); const E = require('../chargeur/etat'); const { creerConstructeur } = require('../chargeur/version');

/** Une entrée comme les bancs la semaient dans l'ancienne collection `visuels` (mêmes champs, mêmes valeurs par défaut). */
const doc = (id, o = {}) => ({ idProduct: id, vignette: { cle: `banc/${id}-v.webp`, w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990101, numero: '001', rarete: 'Common', total: '064', variante: 'normale', setNom: 'Banc Set', lien: null, ...o });
function construire(entrees, liens = []) {
    const b = creerConstructeur();
    for (const e of entrees) b.entree(e);
    for (const [set, cle, ids] of liens) b.lien(set, cle, ids);
    return b.finir();
}
/** Installe la version dans CE processus et rend le chemin d'une archive pour un enfant. */
let n = 0;
function fichier(entrees, liens = []) {
    const v = construire(entrees, liens);
    E.installer(v);
    const p = path.join(os.tmpdir(), `visuels-banc-${process.pid}-${++n}.rmv.gz`);
    fs.writeFileSync(p, zlib.gzipSync(F.serialiser(v)));
    return p;
}
const vider = () => E.vider();
const installer = (entrees, liens = []) => { const v = construire(entrees, liens); E.installer(v); return v; };
module.exports = { doc, construire, fichier, installer, vider };
