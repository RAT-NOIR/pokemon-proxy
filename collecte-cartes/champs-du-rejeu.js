// ============================================================
// CE QU'UN REJEU (`collecteur-texte.js --reparser`) ÉCRIT SUR UNE CARTE — UNE SEULE DÉFINITION (PHASE 3b, 2026-10-24)
// ============================================================
// LE FAIT : `rarete: impCible?.rarete ?? null` écrasait par null la rareté d'une carte dont l'impression cible n'est pas retrouvée dans la page archivée,
// ou n'y porte pas de rareté. Mesuré en phase 3a (controler-reparse.js, lot 3b) : 6 cartes perdaient leur rareté, 2 en CSV5C (Toedscruel ex, Glimmora ex : « RR » -> null) et 4 en smK
// (Cubone, Graveler, Geodude, Golem). Ordre du testeur : « un rejeu n'efface jamais une rareté ».
// LA RÈGLE (tranchée sur ce qui est déjà écrit : « on ne devine jamais, on n'écrase jamais une valeur », §76 ; « une recollecte RÉÉCRIT, elle n'est pas additive », §60) :
//   · la page donne une rareté (non vide) -> la page : c'est la SOURCE de ce champ, une rareté qui a changé à la source se reflète ;
//   · la page n'en donne pas (impression cible introuvable, ou sans rareté) -> la valeur EN BASE est gardée ;
//   · ni l'une ni l'autre -> null (une carte neuve).
// Un champ que la page ne porte pas n'est pas un champ que la page efface : l'absence est un manque de la page, pas une décision.
//
// UNE DÉFINITION POUR TROIS LECTEURS (§21 bis : « corrigé d'un côté, laissé de l'autre ») : collecteur-texte.js (--reparser), page-de-carte.js (collecte normale) et controler-reparse.js
// (le contrôle à blanc, qui était une COPIE mot pour mot de la formule : l'instrument qui regarde ne doit pas lire autre chose que la production).
const { faitsDeCarte } = require('./wikitext');
const { reporterChampsPoses } = require('./impressions-posees');

const vide = v => v == null || (typeof v === 'string' && v.trim() === '');

/** @param {{rarete?: string|null}|undefined} impCible  l'impression cible lue dans la page  @param {string|null|undefined} enBase  la rareté stockée sur la carte */
function rareteDeLaCarte(impCible, enBase) {
    const page = impCible?.rarete;
    if (!vide(page)) return page;
    return vide(enBase) ? null : enBase;
}

/**
 * Les champs qu'un rejeu écrit sur UNE carte à partir de sa page archivée (le `$set` de --reparser, moins la date).
 * @param {{carte: {impressions?: object[], rarete?: string|null, bulba?: {titre?: string}}, epure: string, impressionCible: (faits: object) => object|undefined}} o
 * @returns {{champs: object, faits: object, reportes: number, perdus: number}}
 */
function champsDuRejeu({ carte, epure, impressionCible }) {
    const faits = faitsDeCarte(epure, carte.bulba?.titre);
    const impCible = impressionCible(faits);
    const { champsNuls, ...champs } = faits;
    const P = reporterChampsPoses(carte.impressions, champs.impressions);
    champs.impressions = P.impressions;
    return { champs: { ...champs, rarete: rareteDeLaCarte(impCible, carte.rarete), champsNuls }, faits, reportes: P.reportes, perdus: P.perdus };
}

module.exports = { rareteDeLaCarte, champsDuRejeu };
