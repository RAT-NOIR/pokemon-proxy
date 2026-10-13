// ============================================================
// SOURCES PASSIVES — le worker n'envoie JAMAIS une requête vers elles (décision du testeur, 2026-10-13)
// ============================================================
// « PikaQian : A. Le script passif envoie l'image telle que mon navigateur l'affiche, avec la carte et le numéro ; le worker ne touche
//   jamais le CDN. Mêmes preuves exigées (numéro, nom, set) ; un doute est un trou. Arrête les tentatives automatiques depuis le worker :
//   la source n'est plus interrogée que par mes visites. »
//
// 🔑 UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (§51) : pour le worker, l'ensemble des sources qu'il a le droit de contacter est
// `SOURCES_EN_SERVICE` (sources-en-service.js) ; PikaQian n'y est plus. Ce fichier ne fait que NOMMER la raison, pour que ce qui reste
// en file ou en base se clôture avec un motif écrit plutôt que de disparaître : « source passive : visites du testeur seulement ».
// Rouvrir PikaQian au worker = la remettre dans SOURCES_EN_SERVICE ET la retirer d'ici, dans un commit qui dit pourquoi.
const SOURCES_PASSIVES = Object.freeze({ pikaqian: 'source passive : visites du testeur seulement' });
const estPassive = source => Object.prototype.hasOwnProperty.call(SOURCES_PASSIVES, source);
const motifPassif = source => SOURCES_PASSIVES[source] ?? null;

/**
 * Clôt une unité de file d'une source passive, SANS requête : refusée, le motif écrit, plus jamais reprise d'elle-même.
 * `resultat: 'refuse-source-passive'` n'est dans aucune liste d'arrêts qu'une reprise automatique relit (alimentateur, réessai) : seule une décision la rouvre.
 */
async function cloreUnitePassive(File, unite, maintenant = new Date()) {
    const motif = motifPassif(unite?.source);
    if (!motif) throw new Error(`cloreUnitePassive : « ${unite?.source} » n'est pas une source passive`);
    await File.updateOne({ _id: unite._id }, { $set: { etat: 'refuse', resultat: 'refuse-source-passive', fini: maintenant, erreur: motif }, $unset: { pris: 1, pasAvant: 1 } });
    return { etat: 'refuse', resultat: 'refuse-source-passive', motif };
}

const ID_ALERTE_PASSIVE = 'alerte/source-bloquee/pikaqian';
/**
 * La phrase que file-a-l-arret.js ajoute à une alerte `source-bloquee/<source>` : pour une source passive, plus aucune « prochaine tentative »
 * (l'échéance `pasAvant` encore écrite en base ne programme plus rien). Null pour toute autre alerte : sa phrase d'origine reste.
 */
function phraseAlerte(alerte) {
    const source = String(alerte?._id ?? '').replace(/^alerte\/source-bloquee\//, '');
    if (!String(alerte?._id ?? '').startsWith('alerte/source-bloquee/') || !estPassive(source)) return null;
    return ` · ${motifPassif(source)} : aucune tentative automatique (l'échéance écrite en base ne programme plus rien)`;
}

module.exports = { SOURCES_PASSIVES, estPassive, motifPassif, cloreUnitePassive, phraseAlerte, ID_ALERTE_PASSIVE };
