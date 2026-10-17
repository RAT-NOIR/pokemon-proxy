// ============================================================
// GARDE-ATLAS — à 90 % de 512 Mo, toute écriture NON essentielle s'arrête d'elle-même (testeur, 2026-10-18)
// ============================================================
// Atlas M0 compte les octets BSON de toutes les collections de TOUTES les bases de la grappe, plus leurs index (ATLAS-TAILLE).
// La mesure prend le MAXIMUM de (données + index) et de (stockage + index) : par prudence, deux lectures possibles de la limite.
// 🔑 UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : « je ne sais pas mesurer » (commande refusée, exception, aucune base lue, estimation
// illisible) BLOQUE une écriture non essentielle et le DIT. Seul passe : une mesure lue, sous 90 % (estimation comprise).
// LES IMPORTS CARDMARKET SONT ESSENTIELS ET NE SONT JAMAIS BLOQUÉS : ils traversent le point commun par le drapeau explicite
// `essentiel: 'import-cardmarket'` ET un `fichier` de FICHIERS_ESSENTIELS (liste FERMÉE ; un banc interdit le littéral ailleurs).
'use strict';
const path = require('path');

const LIMITE_MO = 512, ALERTE = 80, REFUS = 90;
const MO = 1048576;
const BASES_IGNOREES = ['admin', 'local', 'config'];
const ESSENTIEL = 'import-cardmarket';
// les SEULS fichiers qui peuvent écrire `essentiel: 'import-cardmarket'` (chemins relatifs à la racine du dépôt, séparateur « / »)
const FICHIERS_ESSENTIELS = Object.freeze(['import-catalogue.js', 'import-price-guide.js', 'imports-quotidiens-local.js']);

const masquer = m => String(m).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 200);
const estNombre = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Mesure UNE grappe à partir d'un client déjà ouvert (MongoClient) : listDatabases, puis dbStats de chaque base. Lève si elle ne peut pas conclure. */
async function mesurerGrappe(client) {
    if (!client || typeof client.db !== 'function') throw new Error('aucun client ouvert : je ne sais pas mesurer la grappe');
    const liste = await client.db('admin').admin().listDatabases();
    const noms = (liste?.databases || []).map(d => d.name).filter(n => !BASES_IGNOREES.includes(n));
    if (!noms.length) throw new Error('aucune base lue sur la grappe : un zéro fabriqué ne mesure rien');
    const bases = [];
    let donnees = 0, stockage = 0;
    for (const nom of noms) {
        const s = await client.db(nom).command({ dbStats: 1, scale: 1 });
        if (![s?.dataSize, s?.indexSize, s?.storageSize].every(estNombre)) throw new Error(`dbStats de « ${nom} » illisible : je ne sais pas mesurer`);
        bases.push({ nom, donneesIndexMo: (s.dataSize + s.indexSize) / MO, stockageIndexMo: (s.storageSize + s.indexSize) / MO });
        donnees += s.dataSize + s.indexSize;
        stockage += s.storageSize + s.indexSize;
    }
    const mo = Math.max(donnees, stockage) / MO;
    return { mo, pourcent: mo / LIMITE_MO * 100, detail: { bases, donneesIndexMo: donnees / MO, stockageIndexMo: stockage / MO } };
}

/** Le fichier appelant est-il dans la liste fermée ? (chemin absolu ou relatif au dépôt) */
function fichierEssentiel(fichier) {
    if (typeof fichier !== 'string' || !fichier) return false;
    const rel = path.isAbsolute(fichier) ? path.relative(path.join(__dirname, '..'), fichier) : fichier;
    return FICHIERS_ESSENTIELS.includes(rel.split(path.sep).join('/'));
}
const essentielValide = (essentiel, fichier) => essentiel === ESSENTIEL && fichierEssentiel(fichier);

/** Pure. { autorise, niveau: 'essentiel' | 'ok' | 'alerte' | 'refus' | 'inconnu', raison }. */
function juger({ mesure, estimationMo = 0, essentiel, fichier } = {}) {
    if (essentielValide(essentiel, fichier)) return { autorise: true, niveau: 'essentiel', raison: 'import Cardmarket : jamais bloqué par la garde de taille' };
    if (!mesure || !estNombre(mesure.mo)) return { autorise: false, niveau: 'inconnu', raison: 'je ne sais pas mesurer la taille de la grappe Atlas : écriture non essentielle refusée' };
    if (!estNombre(estimationMo)) return { autorise: false, niveau: 'inconnu', raison: `estimation « ${estimationMo} » Mo illisible : écriture non essentielle refusée` };
    const projete = (mesure.mo + estimationMo) / LIMITE_MO * 100;
    const txt = `${mesure.pourcent.toFixed(1)} %${estimationMo ? ` + ${estimationMo} Mo estimés = ${projete.toFixed(1)} %` : ''}`;
    if (projete >= REFUS) return { autorise: false, niveau: 'refus', raison: `grappe Atlas à ${txt} (seuil ${REFUS} % de ${LIMITE_MO} Mo) : écriture non essentielle refusée` };
    if (projete >= ALERTE || mesure.pourcent >= ALERTE) return { autorise: true, niveau: 'alerte', raison: `grappe Atlas à ${txt} (alerte dès ${ALERTE} %)` };
    return { autorise: true, niveau: 'ok', raison: `grappe Atlas à ${txt}` };
}

/** Mesure puis juge. NE LÈVE JAMAIS : une mesure impossible rend { autorise: false, niveau: 'inconnu' }. Un import essentiel ne mesure même pas. */
async function verifierEcriture({ client, estimationMo = 0, essentiel, fichier } = {}) {
    if (essentielValide(essentiel, fichier)) return { ...juger({ essentiel, fichier }), mesure: null };
    let mesure = null, erreur = null;
    try { mesure = await mesurerGrappe(client); } catch (e) { erreur = masquer(e.message); }
    const j = juger({ mesure, estimationMo });
    return { ...j, mesure, ...(erreur ? { raison: `${j.raison} — ${erreur}` } : {}) };
}

/** Pure. La ligne imprimée et journalisée après un lot. */
function ligneAtlasApres(mesure, grappe) {
    if (!mesure || !estNombre(mesure.pourcent)) return `Atlas après : mesure impossible (grappe ${grappe})`;
    return `Atlas après : ${mesure.pourcent.toFixed(1).replace('.', ',')} % (grappe ${grappe})`;
}

module.exports = { mesurerGrappe, juger, verifierEcriture, ligneAtlasApres, fichierEssentiel, LIMITE_MO, ALERTE, REFUS, ESSENTIEL, FICHIERS_ESSENTIELS, BASES_IGNOREES };
