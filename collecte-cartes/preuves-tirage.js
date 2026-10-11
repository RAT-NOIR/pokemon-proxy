// ============================================================
// LA LISTE FERMÉE DES PREUVES DE TIRAGE de creer-sets-sans-page.js — et le code qui REFUSE tout le reste
// ============================================================
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : une preuve dont le type n'est pas ici est refusée au chargement de la table TIRAGES.
//   codes_set     — la région que codes_set écrit (japonais / occidental), quand rien ne la contredit ;
//   famille       — les sets EN BASE dont le code est de la même famille ont tous ce tirage ;
//   nom           — le nom Cardmarket de l'expansion dit la langue ;
//   CS…C          — le suffixe « C » des codes chinois de Cardmarket (§39), sur un code « CS…C » ;
//   asymétrie     — des produits désignés sont des cartes imprimées au Japon et JAMAIS dans le tirage occidental ;
//   set           — le set existe déjà en base avec ce tirage ;
//   declarations  — (ruling du coordinateur, 2026-10-11) des impressions de NOS cartes, déclarées par la page de carte Bulbapedia sous
//                   `jpexpansion` (japonais) / `expansion` (occidental), portent ce nom d'expansion EXACT, et aucune impression d'un autre
//                   tirage ne le porte (« pages de cartes : » est l'ancien libellé, 2026-10-07) ;
//   page          — (ruling du coordinateur, 2026-10-11) la page Bulbapedia du produit, lue dans sa copie Wayback citée, dit la langue en toutes
//                   lettres (« English … cards », « Japanese promotional cards ») ; admise SEULEMENT avec une seconde preuve admise OU une
//                   citation qui nomme le produit (« citation nomme le produit : « … » ») ;
//   tcgdex        — HÉRITÉE (2026-10-07, décision du testeur pour les sets AS et Black Sparkle) : un set TCGdex data-asia nomme l'expansion.
// Ce qui n'a aucune de ces preuves n'est PAS dans la table : A-VALIDER.md le propose au testeur.
const TYPES = ['codes_set', 'famille', 'nom', 'CS…C', 'asymétrie', 'set', 'declarations', 'page', 'tcgdex'];
const TIRAGES_ADMIS = ['jp', 'intl', 'zh-hans', 'zh-hant', 'id', 'th', 'idth', 'ko'];

/** Le type de la preuve que ce segment écrit, ou null. */
function typeDePreuve(segment) {
    const s = String(segment ?? '').trim();
    if (/^pages de cartes\s*:/i.test(s)) return 'declarations';
    if (/^TCGdex\b/.test(s)) return 'tcgdex';
    const m = /^(codes_set|famille|nom|CS…C|asymétrie|set|declarations|page)\s*:/.exec(s);
    return m ? m[1] : null;
}

/** LÈVE sur la première preuve hors liste ou mal formée. `T` : { idExpansion: [tirage, texte de preuve] }. */
function verifierTirages(T) {
    for (const [exp, v] of Object.entries(T)) {
        const [tirage, texte] = v;
        if (!TIRAGES_ADMIS.includes(tirage)) throw new Error(`exp ${exp} : tirage « ${tirage} » hors liste (${TIRAGES_ADMIS.join(', ')})`);
        const segments = String(texte ?? '').split(' ; ').map(x => x.trim()).filter(Boolean);
        const types = segments.map(typeDePreuve);
        if (!types.length || types[0] == null) throw new Error(`exp ${exp} : type de preuve absent de la liste fermée (${TYPES.join(', ')}) : « ${String(texte).slice(0, 80)} »`);
        segments.forEach((seg, i) => {
            const ty = types[i];
            if (ty === 'declarations' && /^declarations/.test(seg) &&!/\d+ (cartes?|impressions?)/.test(seg)) throw new Error(`exp ${exp} : declarations sans le nombre de cartes ou d'impressions : « ${seg.slice(0, 80)} »`);
            if (ty === 'page') {
                const citee = /«[^»]+»/.test(seg) && /copie Wayback \d{14}/.test(seg);
                const seconde = types.some((t, j) => j !== i && t && t !== 'page'), nomme = segments.some(s => /^citation nomme le produit\s*:\s*«[^»]+»/.test(s));
                if (!citee) throw new Error(`exp ${exp} : preuve page sans citation « … » ni copie Wayback datée (14 chiffres) : « ${seg.slice(0, 80)} »`);
                if (!seconde && !nomme) throw new Error(`exp ${exp} : preuve page admise seulement avec une seconde preuve admise OU « citation nomme le produit : « … » »`);
            }
        });
    }
    return true;
}

module.exports = { TYPES, TIRAGES_ADMIS, typeDePreuve, verifierTirages };
