// LA RELECTURE DES IMPRESSIONS APRÈS ÉCRITURE (PHASE 3b, 2026-10-24) — fonction PURE, une seule définition pour poser-fiches-par-setlist.js et son banc.
//
// POURQUOI : le lot 5b (XY-P, 24/10, 13:50 UTC) a écrit 8 lignes justes, puis l'outil est sorti en code 1 sur « impressions « setlist » 0/8 ».
// Les 8 cartes portaient DÉJÀ l'impression jp « XY-P Promotional cards » au même numéro, posée par leur page (`source` absente) : le plan n'avait
// rien à poser, et la relecture exigeait quand même une impression `source === 'setlist'` pour CHAQUE ligne. Elle contrôlait la PROVENANCE
// d'une impression, alors que la question est : « la carte a-t-elle, EN BASE, l'impression que la ligne suppose ? ».
//
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE. Deux conditions, et une seule porte de sortie vers « ok » :
//  (1) chaque impression PLANIFIÉE (celle que cet outil devait poser) est en base sur sa carte — quelle que soit sa `source` ;
//  (2) chaque LIGNE écrite a son impression (tirage, expansion, cleNumero) sur sa carte — posée par cet outil ou par un autre.
// Une ligne sans impression du tout échoue ; une impression planifiée absente échoue ; une carte absente de la relecture échoue.
// La clé de comparaison est celle de la production (`cleNumero` de jointure.js) : « 001 » EST « 1 ». Rien n'est recopié.
const { cleNumero } = require('./jointure');

/** La carte porte-t-elle une impression (tirage, expansion, numéro à cleNumero près) ? `source` n'entre PAS dans la clé. */
function porteImpression(carte, { tirage, expansion, numero }) {
    if (!carte) return false;
    const k = cleNumero(numero);
    return (carte.impressions || []).some(i => i && i.tirage === tirage && i.expansion === expansion && cleNumero(i.numero) === k);
}

/**
 * @param {Map<any, object>} cartesParId  les cartes RELUES en base (impressions)
 * @param {Array<{carteId, tirage, expansion, numero}>} lignes  une entrée par ligne écrite
 * @param {Array<{carteId, imp: {tirage, expansion, numero}}>} planifiees  les impressions que l'outil devait poser
 * @returns {{ok: boolean, planifieesOk: number, planifieesTotal: number, lignesOk: number, lignesTotal: number, manques: string[]}}
 */
function relireImpressions({ cartesParId, lignes, planifiees }) {
    const manques = [];
    // dédoublonnage par (carte, tirage, expansion, cleNumero) : deux produits d'une même carte au même numéro ne comptent qu'une fois
    const cle = (carteId, o) => `${carteId}|${o.tirage}|${o.expansion}|${cleNumero(o.numero)}`;
    const uniques = (xs, f) => { const m = new Map(); for (const x of xs) m.set(f(x), x); return [...m.values()]; };
    const plan = uniques(planifiees, x => cle(x.carteId, x.imp));
    const lig = uniques(lignes, x => cle(x.carteId, x));
    const planifieesOk = plan.filter(x => { const ok = porteImpression(cartesParId.get(x.carteId), x.imp); if (!ok) manques.push(`impression planifiée absente : carte ${x.carteId} · ${x.imp.tirage} · ${x.imp.expansion} · n°${x.imp.numero}`); return ok; }).length;
    const lignesOk = lig.filter(x => { const ok = porteImpression(cartesParId.get(x.carteId), x); if (!ok) manques.push(`ligne sans impression : carte ${x.carteId} · ${x.tirage} · ${x.expansion} · n°${x.numero}`); return ok; }).length;
    return { ok: planifieesOk === plan.length && lignesOk === lig.length, planifieesOk, planifieesTotal: plan.length, lignesOk, lignesTotal: lig.length, manques };
}

module.exports = { relireImpressions, porteImpression };
