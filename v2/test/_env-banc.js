'use strict';
// L'ENVIRONNEMENT D'UN BANC V2 — écrit par ce qu'il AUTORISE (INT2, ruling du coordinateur 2026-10-08).
// 🔴 La cause de l'incident : le harnais charge .env, donc process.env portait MONGODB_URI de PRODUCTION pour tout code qui ouvrait Mongo hors ouvrirBancV2.
// Ici : toute variable MONGODB_* et toute variable dont la VALEUR est une URI mongodb (quel que soit son nom) est RETIRÉE, et BANC_ISOLE=1 est posé.
// Une seule exception : l'URI d'un banc DÉJÀ isolé que le parent a posée par appliquer() (BANC_ISOLE=1, hôte = BANC_HOTES, loopback) — un enfant la garde.
// Un seul doute dans cet environnement (une URI hors banc à côté d'une URI de banc) retire TOUT : on ne trie pas un environnement douteux.
// Une lecture de production, si elle est un jour légitime, passe par la façade de collecte-cartes/base-banc.js, jamais par l'env d'un banc.
// Partagé par _harnais.js ET lancer-tout.js (deux copies de la règle divergeraient).
const { verifierHoteBanc, hotesDe } = require('../../collecte-cartes/garde-banc');

const estUriMongo = v => typeof v === 'string' && /^mongodb(\+srv)?:\/\//i.test(v.trim());
const estLoopback = h => /^127(\.\d{1,3}){3}$/.test(h) || h === '[::1]' || h === 'localhost';
const uriDeBanc = (v, env) => estUriMongo(v) && env.BANC_ISOLE === '1' && verifierHoteBanc(v, env).ok && hotesDe(v).length > 0 && hotesDe(v).every(estLoopback);

/** Purge `env` en place (process.env ou une copie). Rend les noms retirés. */
function purgerEnv(env = process.env) {
    const suspectes = Object.entries(env).filter(([k, v]) => /^MONGODB_/.test(k) || estUriMongo(v));
    const uris = suspectes.filter(([, v]) => estUriMongo(v));
    const heritage = uris.length > 0 && uris.every(([, v]) => uriDeBanc(v, env));
    const retires = [];
    for (const [k, v] of suspectes) {
        if (heritage && (estUriMongo(v) ? true : /^MONGODB_BASE$/.test(k))) continue;   // enfant d'un banc isolé : ses URI de banc et sa base nommée restent
        delete env[k]; retires.push(k);
    }
    env.BANC_ISOLE = '1';
    return retires;
}
module.exports = { purgerEnv, estUriMongo };
