// ============================================================
// TAIWAN — `numeroFiche` des 45 « Traditional Chinese Products » (Traditional-Chinese-Products, tirage zh-hant), lu dans le SLUG Cardmarket (testeur, 2026-10-18)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (mot pour mot) : « Taïwan : feu vert pour poser numeroFiche sur les 44 lignes (essai à blanc, écriture, revérification). »
//
// 🔑 LA FORME (ruling, sur pièces) : `numeroFiche` = CODE DE LA LISTE TPC tw + NUMÉRO, collés, tels que le slug les écrit : « SV-P117 », « S-P162 » (zéros du slug gardés : « SV-P057 »).
//   · PIÈCE 1 — les numéros se RÉPÈTENT d'une liste à l'autre : S-P 162, 163, 164 (Rowlet, Cyndaquil, Oshawott) et SV-P 162, 163, 164 (Giratina VSTAR, Lugia VSTAR, Miraidon ex) sont six produits
//     de six cartes. Un numéro nu (« 162 ») ne les sépare pas : c'est la liste qui les sépare. Sur une ligne à deux listes (SV-P 238 cartes, S-P 152), `planifierTpc` (collecte-cartes/tpc.js) range
//     une fiche sous « <LISTE><numéro> » ; le préfixe de NOTRE numéro EST la liste (comme « a019 » des demi-listes AS), donc la forme du plan est déjà celle-ci.
//   · PIÈCE 2 — la clé de la jointure TPC, `cleNumero`, garde un préfixe alphabétique à trait d'union (`^([A-Z-]*)0*(\d+)([A-Z]*)$` : « SV-P117 » reste « SV-P117 ») ; la lettre seule (« a ») ne
//     désigne pas SV-P contre S-P. `planifierTpc` lisait le préfixe par `[A-Z]*` (sans trait d'union) : étendu à `[A-Z-]*`, comme cleNumero et comme la reprise du collecteur.
//   · PIÈCE 3 — les lignes voisines déjà écrites : « a019 » (lettre de demi-liste + numéro) sur les sets AS ; « 149 » (numéro nu) sur les sets TPC à UNE liste (SV-P thaï, indonésien…). Une liste unique
//     n'a pas besoin de préfixe ; la ligne Products en a DEUX : elle porte le préfixe, comme AS.
//   · COÛT SI FAUX : `numeroFiche` ne sert qu'à (a) ranger un produit sur une fiche numérotée du site — le set n'a AUCUNE fiche numérotée aujourd'hui (le diff « servi » le mesure : 0 changement) —
//     et (b) à chercher la fiche TPC de ce numéro. Un préfixe faux fait chercher la mauvaise liste : la preuve par le Pokédex/PV/règle refuse (jamais une image fausse), il en résulte un TROU, pas un mensonge.
//     Retour en arrière : `--restaurer` (null, comme avant).
//
// LE SLUG, lu par ce qu'il AUTORISE : seules trois écritures sont reconnues, tout le reste est laissé et listé avec sa raison —
//   1. `…<LISTE>-<n>` ou `…<LISTE><n>` en FIN de slug, LISTE ∈ { SV-P, S-P } (« Fuecoco-SV-P117 », « Pikachu-PKMTCHSV-P-169 », « Rowlet-PKMTCHS-P-162 », « Oshawott-S-PS-P-164 ») → preuve `slug` ;
//   2. `…PKMTCH<nnn>` en fin de slug, SANS code de liste (« Rowlet-PKMTCH231 » : 11 produits, 231 à 242) → liste SV-P DÉDUITE, preuve `slug+liste-deduite` (voir DEDUCTION_SANS_LISTE) ;
//   3. aucun chiffre en fin de slug (« Terapagos-Friends-SV-P ») → LAISSÉ : le 45e produit, que le slug ne numérote pas.
// Une même (liste, numéro) réclamée par deux CARTES différentes est laissée (les deux) : la clé ne désigne rien.
const LISTES = Object.freeze(['SV-P', 'S-P']);
// Les 11 « PKMTCH<nnn> » nus : la liste est DÉDUITE, jamais lue. Pièces : les 4 produits S-P portent TOUS le code (« PKMTCHS-P-… », « S-PS-P-… »), aucun nu n'est marqué S-P ; les nus (231…242) sont dans la
// suite immédiate de SV-P 243 à 246, tous marqués. Hypothèse ÉCRITE, pas prouvée : la preuve par le Pokédex à la collecte la confirme ou la refuse (un trou, jamais une image fausse).
const DEDUCTION_SANS_LISTE = Object.freeze({ liste: 'SV-P', motif: 'les 4 produits S-P portent tous le code de liste dans leur slug ; les PKMTCH<nnn> nus (231 à 242) précèdent immédiatement SV-P 243 à 246' });

/** Lit la liste et le numéro d'un slug Cardmarket de la ligne Products. @returns {{liste: string, numero: string, voie: 'slug'|'slug+liste-deduite'}|{motif: string}} */
function lireSlug(slug) {
    const s = String(slug ?? '');
    const m = /(SV-P|S-P)-?(\d{1,3})$/.exec(s);
    if (m) return { liste: m[1], numero: m[2], voie: 'slug' };
    const n = /PKMTCH(\d{1,3})$/.exec(s);
    if (n) return { liste: DEDUCTION_SANS_LISTE.liste, numero: n[1], voie: 'slug+liste-deduite' };
    return { motif: 'slug-sans-numero' };
}

const comparable = n => String(n ?? '').trim().toUpperCase().replace(/^([A-Z-]*)0*(\d+)$/, '$1$2');

/**
 * LE PLAN, pur : chaque ligne `cartes_produits` du set reçoit son `numeroFiche` (liste + numéro lus dans son slug) ou une RAISON. Rien n'est écrit.
 * @param {Array<{_id: string, idProduct: number, carteId: number, slug?: string, numeroFiche?: string|null}>} lignes
 */
function planDesLignes(lignes) {
    const pose = [], laissees = [];
    const candidates = [];
    for (const l of lignes) {
        const base = { _id: l._id, idProduct: l.idProduct, carteId: l.carteId, slug: l.slug ?? null };
        if (l.numeroFiche !== null && l.numeroFiche !== undefined && l.numeroFiche !== '') { laissees.push({ ...base, motif: 'deja-numerotee', numeroFiche: l.numeroFiche }); continue; }
        const r = lireSlug(l.slug);
        if (r.motif) { laissees.push({ ...base, motif: r.motif }); continue; }
        // RULING DU COORDINATEUR (2026-10-18, règle du testeur « les cas douteux sont sautés ») : une liste DÉDUITE n'est jamais écrite. « PKMTCH231 » peut être la numérotation interne de Cardmarket pour
        // l'expansion, pas le numéro de la promo SV-P : poser « SV-P231 » serait écrire une hypothèse en base. Aucune option ne les réintègre.
        if (r.voie !== 'slug') { laissees.push({ ...base, motif: 'liste-non-lue-dans-le-slug', numeroFiche: `${r.liste}${r.numero}` }); continue; }
        candidates.push({ ...base, liste: r.liste, numeroFiche: `${r.liste}${r.numero}`, voie: r.voie });
    }
    // une (liste, numéro) pour deux CARTES : la clé ne désigne rien — les deux sont laissées
    const parCle = new Map();
    for (const c of candidates) { const k = comparable(c.numeroFiche); (parCle.get(k) || parCle.set(k, new Set()).get(k)).add(c.carteId); }
    for (const c of candidates) {
        if (parCle.get(comparable(c.numeroFiche)).size > 1) { laissees.push({ _id: c._id, idProduct: c.idProduct, carteId: c.carteId, slug: c.slug, motif: 'numero-pris-par-une-autre-carte', numeroFiche: c.numeroFiche }); continue; }
        pose.push({ ...c, preuve: c.voie === 'slug' ? `slug Cardmarket « ${c.slug} » : liste ${c.liste}, numéro ${c.numeroFiche.slice(c.liste.length)}` : `slug Cardmarket « ${c.slug} » : numéro ${c.numeroFiche.slice(c.liste.length)} sans code de liste ; liste ${c.liste} DÉDUITE (${DEDUCTION_SANS_LISTE.motif})` });
    }
    const parMotif = {};
    for (const l of laissees) parMotif[l.motif] = (parMotif[l.motif] || 0) + 1;
    const parListe = {}, parVoie = {};
    for (const p of pose) { parListe[p.liste] = (parListe[p.liste] || 0) + 1; parVoie[p.voie] = (parVoie[p.voie] || 0) + 1; }
    return { pose, laissees, comptes: { lignes: lignes.length, pose: pose.length, laissees: laissees.length, parMotif, parListe, parVoie } };
}

module.exports = { LISTES, DEDUCTION_SANS_LISTE, lireSlug, planDesLignes, comparable };
