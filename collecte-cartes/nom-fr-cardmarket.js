'use strict';
// ============================================================
// LA RÈGLE DU NOM FRANÇAIS CARDMARKET — UNE SEULE COPIE (§21 bis)
// ============================================================
// Extraite de rapatrier-noms-fr.js : l'outil historique ET poser-noms-fr-fiches.js l'importent. Deux copies d'une règle de nom divergent
// toujours. Banc : test-nom-fr-cardmarket.js (sortie identique à la copie gelée d'avant extraction, y compris sur les données réelles).
//
// Trois règles, dans l'ordre :
//   1. LE NOM SEUL (nomSeul) : toute parenthèse finale et « Lv.<chiffres> » sont des suffixes de PRODUIT ; « LV.X » est une carte, il reste.
//   2. UNE CARTE PORTE PLUSIEURS PRODUITS : si leurs noms (clés `cle`) divergent, c'est un conflit -> null, jamais l'un des deux.
//   3. LES ACCENTS DÉPARTAGENT : « Elektek »/« Élektek » = une seule clé ; on garde la forme la plus accentuée, puis la plus fréquente.

// Les suffixes que Cardmarket colle au nom du PRODUIT (liste ÉNUMÉRÉE par `rapatrier-noms-fr.js --parentheses`, pas devinée).
const PARENTHESE = /\s*\([^)]*\)\s*$/;
// « Lv.10 » CHIFFRÉ est un suffixe, « LV.X » est une carte : le motif exige des chiffres.
const NIVEAU = /\s*Lv\.?\s?\d+\s*$/i;
const nomSeul = s => {
    let t = String(s || '').trim();
    for (let i = 0; i < 3 && PARENTHESE.test(t); i++) t = t.replace(PARENTHESE, '').trim();   // « X (Holo) (V.2) »
    return t.replace(NIVEAU, '').replace(/\s*-\s*(?:Holo|Reverse Holo)\s*$/i, '').trim();
};
// la clé de comparaison : accents, casse et ponctuation retirés. « Mélo » = « Melo ».
const cle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const accents = s => (String(s).normalize('NFD').match(/[̀-ͯ]/g) || []).length;

/** produits Cardmarket (numeros_cartes) -> Map idProduct -> nom seul ; un produit sans nomFr n'y figure pas. */
function frParProduit(produits) {
    return new Map(produits.filter(p => p.nomFr && String(p.nomFr).trim()).map(p => [p.idProduct, nomSeul(p.nomFr)]));
}

/** lignes cartes_produits -> Map carteId -> Map cle -> { formes: Map forme -> n, n } (toutes les formes vues, comptées). */
function grouperParCarte(liens, frDuProduit) {
    const parCarte = new Map();
    for (const l of liens) {
        const fr = frDuProduit.get(l.idProduct);
        if (!fr) continue;
        const e = parCarte.get(l.carteId) || (parCarte.set(l.carteId, new Map()), parCarte.get(l.carteId));
        const k = cle(fr);
        const g = e.get(k) || (e.set(k, { formes: new Map(), n: 0 }), e.get(k));
        g.formes.set(fr, (g.formes.get(fr) || 0) + 1); g.n++;
    }
    return parCarte;
}

/** la forme retenue d'un groupe : la plus accentuée, puis la plus fréquente. */
const formeRetenue = g => [...g.formes].sort((a, b) => (accents(b[0]) - accents(a[0])) || (b[1] - a[1]))[0][0];

/**
 * La décision pour UNE carte. groupes : Map cle -> groupe (voir grouperParCarte).
 * -> { conflit, nomFr (null si conflit), accentue (deux graphies départagées), groupes: [{ cle, forme, n }] }
 */
function decider(groupes) {
    if (groupes.size > 1) {
        return { conflit: true, nomFr: null, accentue: false, groupes: [...groupes].map(([k, g]) => ({ cle: k, forme: formeRetenue(g), n: g.n })) };
    }
    const [[k, g]] = [...groupes];
    return { conflit: false, nomFr: formeRetenue(g), accentue: g.formes.size > 1, groupes: [{ cle: k, forme: formeRetenue(g), n: g.n }] };
}

module.exports = { nomSeul, cle, accents, frParProduit, grouperParCarte, formeRetenue, decider };
