// ============================================================
// PRÉSÉANCE DE RÉSOLUTION — deux images JUSTES d'un même (carte, set, numéro) : la plus grande (décision 4 du testeur, 2026-10-13)
// ============================================================
// « Les 5 cartes de Celebrations à deux images justes : la plus grande résolution ; à égalité, TCGdex. »
//
// POURQUOI : l'invariant « une image par (carte, set, numéro) » (§32 bis) a été rompu le 2026-10-13 ~10:25 UTC : le worker (collecteur TCGdex) a
// téléchargé 5 images de Celebrations APRÈS les 29 de pokemontcg.io (collecteur-images-ptcgio.js, additif : il ne comble que les trous). Aucun des deux
// ne regardait l'autre — le worker pose son entrée (pull de SES entrées, puis push) sans lire les entrées des autres sources, et pokemontcg.io, additif,
// cède devant toute autre source (dejaServi) mais ne retire rien. Les deux images sont justes (pas de mensonge) ; le site ne devait pas avoir à choisir.
//
// UNE règle, lue par les DEUX écritures (§21 bis) : la jointure du worker TCGdex (collecteur-images-tcgdex.js) et la jointure de pokemontcg.io
// (collecteur-images-ptcgio.js) — et par l'outil des doublons existants (mettre-en-conformite-preseance.js). Celle qui perd n'ajoute pas son entrée ;
// celle qui gagne retire la perdante.
//
// 🔑 ELLE S'ÉCRIT PAR CE QU'ELLE AUTORISE (en tête de CLAUDE.md) : un verdict n'existe que pour DEUX entrées
//   · de DEUX sources différentes, TOUTES DEUX dans SOURCES_ARBITREES (TCGdex et pokemontcg.io) — une autre paire, Bulbapedia / TCGdex comprise
//     (sa préséance est celle du remplacement, §55, avec son risque de langue), ne reçoit AUCUN verdict ;
//   · du MÊME set et du MÊME numéro (cleNumero, la clé de la jointure), ce numéro étant CONNU ;
//   · de la MÊME langue, CONNUE (deux langues inconnues ne sont pas « la même ») ;
//   · dont les dimensions (w, h : le fichier SERVI) sont connues et positives ;
//   · dont aucune n'est de basse définition (la règle de la marque vit dans basse-definition.js).
//   Tout le reste : `null`, rien ne bouge.
// LE CRITÈRE : l'aire du fichier servi (w × h) ; à égalité, TCGdex. Si la règle changeait demain, ce fichier bougerait — et la garde du commit du
// worker le surveille (remettre-en-file.js, REGLES), puisque le worker TCGdex l'exécute.
const { cleNumero } = require('./jointure');

const SOURCE_TCGDEX = 'tcgdex';
const SOURCE_PTCGIO = 'pokemontcg.io';          // = ptcgio.js SOURCE ; recopiée ici pour ne pas charger la table de ptcgio dans le worker (le banc vérifie l'égalité)
const SOURCES_ARBITREES = Object.freeze([SOURCE_TCGDEX, SOURCE_PTCGIO]);
const MOTIF = 'préséance de résolution';

const aire = e => (Number.isFinite(e?.w) && Number.isFinite(e?.h) && e.w > 0 && e.h > 0) ? e.w * e.h : null;
const langueConnue = e => typeof e?.langue === 'string' && e.langue !== '';

/** Une entrée que la règle PEUT juger : toutes les conditions d'entrée, une par une. */
function arbitrable(e) {
    return !!e && typeof e === 'object' && SOURCES_ARBITREES.includes(e.source) && typeof e.set === 'string' && e.set !== ''
        && e.numero != null && String(e.numero).trim() !== '' && langueConnue(e) && aire(e) !== null && e.basseDefinition !== true;
}

/** Deux entrées désignent la même impression ET sont jugeables l'une contre l'autre. */
function concurrentes(a, b) {
    return arbitrable(a) && arbitrable(b) && a.source !== b.source && a.set === b.set && a.langue === b.langue && cleNumero(a.numero) === cleNumero(b.numero);
}

/**
 * Le verdict entre deux entrées. @returns {{gagnante, perdante, aireGagnante, airePerdante, motif}|null} — `null` : la règle ne juge pas cette paire.
 */
function departager(a, b) {
    if (!concurrentes(a, b)) return null;
    const [aa, ab] = [aire(a), aire(b)];
    const gagnante = aa > ab ? a : ab > aa ? b : (a.source === SOURCE_TCGDEX ? a : b);   // à égalité : TCGdex
    const perdante = gagnante === a ? b : a;
    return { gagnante, perdante, aireGagnante: aire(gagnante), airePerdante: aire(perdante),
        motif: `${MOTIF} : ${gagnante.source} ${gagnante.w}×${gagnante.h} (${aire(gagnante)}) contre ${perdante.source} ${perdante.w}×${perdante.h} (${aire(perdante)})${aa === ab ? ' — égalité : TCGdex' : ''}` };
}

/**
 * Ce qu'une écriture demande AVANT d'ajouter une entrée : les entrées déjà là (`images`, celles d'une carte, SANS les propres entrées de l'écriture
 * qu'elle s'apprête à réécrire) contre la candidate.
 *   perd      : la candidate perd contre AU MOINS une entrée → elle n'ajoute rien (prudence : un seul conflit perdu suffit)
 *   aRetirer  : si elle ne perd pas, les entrées qu'elle bat et qui doivent sortir de `cartes.images`
 *   conflits  : les verdicts, pour le journal
 */
function contre(images, candidate) {
    const conflits = (Array.isArray(images) ? images : []).filter(e => e !== candidate).map(e => ({ entree: e, verdict: departager(e, candidate) })).filter(x => x.verdict);
    const perd = conflits.some(x => x.verdict.gagnante !== candidate);
    return { perd, aRetirer: perd ? [] : conflits.map(x => x.entree), conflits: conflits.map(x => ({ entree: x.entree, motif: x.verdict.motif })) };
}

/**
 * Les doublons d'une carte, pour l'outil de mise en conformité : par (set, numéro, langue), la meilleure entrée garde sa place, les autres jugeables contre elle
 * sont perdantes. @returns {{perdante, gagnante, motif}[]}
 */
function perdantesDeLaCarte(images) {
    const liste = (Array.isArray(images) ? images : []).filter(arbitrable);
    const groupes = new Map();
    for (const e of liste) { const k = `${e.set}|${cleNumero(e.numero)}|${e.langue}`; (groupes.get(k) || groupes.set(k, []).get(k)).push(e); }
    const sorties = [];
    for (const g of groupes.values()) {
        if (new Set(g.map(e => e.source)).size < 2) continue;
        const meilleure = g.reduce((m, e) => (departager(m, e)?.gagnante === e ? e : m));
        for (const e of g) { const v = e === meilleure ? null : departager(meilleure, e); if (v && v.perdante === e) sorties.push({ perdante: e, gagnante: meilleure, motif: v.motif }); }
    }
    return sorties;
}

module.exports = { SOURCES_ARBITREES, SOURCE_TCGDEX, SOURCE_PTCGIO, MOTIF, aire, arbitrable, concurrentes, departager, contre, perdantesDeLaCarte };
