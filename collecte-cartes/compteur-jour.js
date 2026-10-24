// ============================================================
// LE COMPTEUR DE REQUÊTES DU JOUR, PAR SOURCE (PHASE 3a, D5 du 2026-10-24)
// ============================================================
// « Son plafond --max se cumule sur la journée, et non par lancement. » Le client TPC refuse la requête n° plafond + 1 (tpc.js : plafond, compteInitial, surRequete) ; ce module porte le COMPTE entre deux
// lancements, dans un fichier local : { sites: { '<site>': { jour: 'AAAA-MM-JJ' (UTC), n: <requêtes du jour> } } }. Écrit par ce qu'il autorise :
//   · fichier ABSENT = 0 (premier passage) ; fichier présent mais illisible, ou un compte qui n'est pas un entier ≥ 0 = LÈVE (un repli sur 0 remettrait le plafond à neuf, comme au 2026-10-12 pour collecter-tpc-set.js) ;
//   · une entrée d'un AUTRE jour vaut 0 (le jour change à minuit UTC, comme les horodatages de la base).
const fs = require('fs');
const path = require('path');

const jourUtc = (d = new Date()) => d.toISOString().slice(0, 10);

function lireTout(fichier, lire = f => fs.readFileSync(f, 'utf8'), existe = f => fs.existsSync(f)) {
    if (!existe(fichier)) return { sites: {} };
    let j;
    try { j = JSON.parse(lire(fichier)); } catch (e) { throw new Error(`compteur du jour illisible (${fichier}) : ${String(e.message).slice(0, 100)} — je ne repars pas sur 0`); }
    if (!j || typeof j !== 'object' || typeof j.sites !== 'object' || j.sites === null) throw new Error(`compteur du jour (${fichier}) : forme inattendue — je ne repars pas sur 0`);
    return j;
}

/** Le nombre de requêtes déjà faites AUJOURD'HUI chez cette source. */
function lireCompteur(fichier, site, jour = jourUtc(), io = {}) {
    const e = lireTout(fichier, io.lire, io.existe).sites[site];
    if (e === undefined) return 0;
    if (!e || typeof e.jour !== 'string' || !Number.isInteger(e.n) || e.n < 0) throw new Error(`compteur du jour (${fichier}) : l'entrée de ${site} est illisible (${JSON.stringify(e)}) — je ne repars pas sur 0`);
    return e.jour === jour ? e.n : 0;
}

/** Écrit le compte (les autres sources du fichier sont gardées). */
function ecrireCompteur(fichier, site, n, jour = jourUtc(), io = {}) {
    if (!Number.isInteger(n) || n < 0) throw new Error(`compteur : « ${n} » n'est pas un entier ≥ 0`);
    const tout = lireTout(fichier, io.lire, io.existe);
    tout.sites[site] = { jour, n, le: new Date().toISOString() };
    (io.ecrire || ((f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); }))(fichier, JSON.stringify(tout));
}

module.exports = { jourUtc, lireCompteur, ecrireCompteur };
