// ============================================================
// FICHES CHINOISES : PREUVE PAR LE SET (décision du testeur, 2026-10-31) — module PUR
// ============================================================
// LA RÈGLE : si la liste d'une source pour un set et les produits Cardmarket du MÊME set concordent NOM POUR NOM sur TOUT le set (mêmes noms, mêmes
// EFFECTIFS, aucun orphelin des deux côtés), la numérotation de la source est admise pour les cartes du set. UNE SEULE discordance et la règle ne
// s'applique pas : le set retombe sur la règle carte par carte (deux sources, deux-sources.js / voie-deux-sources.js).
// ÉCRIT PAR CE QU'ELLE AUTORISE : `admis` n'est vrai que si `discordances` est vide ; tout ce qui n'a pas été prouvé (nom intraduisible, numéro en double, produit
// sans clé, effectif différent, groupe incohérent, liste vide) est une discordance NOMMÉE, jamais un « à peu près ».
// ⚠️ La traduction zh -> en ne se DEVINE pas : `traduire(nomZh)` est injectée (table existante ou ouverte) ; elle rend une clé, ou null — et null ferme le set.
// ⚠️ Les noms Cardmarket sont ramenés à leur clé par les fonctions de PRODUCTION (decomposerNomCardmarket, normaliserNom de jointure.js), jamais par une copie.
// ⚠️ MULTIPLICITÉS COMPTÉES (Map de compteurs), jamais un Set : un Set écrase le doublon qui fait passer « A,A,B » pour « A,B,B » (§34).
// ⚠️ Deux produits du même nom (V1/V2, groupes de Gem Pack « 01 01/15 ») : le nom ne dit pas lequel porte quel numéro. Une attribution `exacte` n'est rendue que pour
//    un nom porté par UN produit et UNE entrée ; les autres sont rendues `ambigus` — ou, si l'appelant donne `groupeDe` et le numéro Cardmarket des produits, au niveau `groupe`
//    (le numéro de groupe du produit, avec la liste des numéros candidats de la source) : on ne choisit jamais une variante au hasard.
const { decomposerNomCardmarket, normaliserNom } = require('./jointure');

const cleProduitParDefaut = name => { const n = normaliserNom(decomposerNomCardmarket(name).nom); return n || null; };
const compter = (m, k) => m.set(k, (m.get(k) || 0) + 1);

/**
 * @param {object} o
 * @param {Array<{numero: string, nomZh: string}>} o.source        la liste de la source pour le set
 * @param {Array<{idProduct: number, name: string, numero?: string|null}>} o.produits   les produits Cardmarket du MÊME set
 * @param {(nomZh: string) => (string|null)} o.traduire             nom de la source -> clé (null = intraduisible)
 * @param {(name: string) => (string|null)} [o.cleProduit]          nom Cardmarket -> clé (défaut : nom de production sans crochets, normalisé)
 * @param {(numeroSource: string) => string} [o.groupeDe]           numéro de la source -> numéro de groupe Cardmarket (Gem Packs)
 * @returns {{admis: boolean, raison: string, attributions: object[], ambigus: object[], discordances: object[], denominateurs: object}}
 */
function prouverParSet({ source, produits, traduire, cleProduit = cleProduitParDefaut, groupeDe = null }) {
    const discordances = [];
    const denominateurs = { source: (source || []).length, produits: (produits || []).length };
    const refus = raison => ({ admis: false, raison, attributions: [], ambigus: [], discordances, denominateurs });
    if (typeof traduire !== 'function') throw new Error('traduire(nomZh) est obligatoire : la traduction ne se devine pas');
    if (!denominateurs.source || !denominateurs.produits) { discordances.push({ type: 'liste-vide', ...denominateurs }); return refus(`liste vide (source ${denominateurs.source}, produits ${denominateurs.produits}) : rien à prouver`); }

    const parCleSource = new Map(), parCleProduit = new Map();   // cle -> [entrées]
    const numerosVus = new Map();
    for (const e of source) {
        compter(numerosVus, String(e.numero));
        const cle = traduire(e.nomZh);
        if (cle == null || cle === '') { discordances.push({ type: 'intraduisible', numero: String(e.numero), nomZh: e.nomZh }); continue; }
        (parCleSource.get(cle) || parCleSource.set(cle, []).get(cle)).push(e);
    }
    for (const [n, c] of numerosVus) if (c > 1) discordances.push({ type: 'numero-double', numero: n, fois: c });
    for (const p of produits) {
        const cle = cleProduit(p.name);
        if (cle == null || cle === '') { discordances.push({ type: 'produit-sans-cle', idProduct: p.idProduct, name: p.name }); continue; }
        (parCleProduit.get(cle) || parCleProduit.set(cle, []).get(cle)).push(p);
    }
    // les effectifs, clé par clé, DES DEUX CÔTÉS
    const toutes = new Set([...parCleSource.keys(), ...parCleProduit.keys()]);
    for (const cle of toutes) {
        const s = parCleSource.get(cle) || [], p = parCleProduit.get(cle) || [];
        if (s.length !== p.length) discordances.push({ type: 'effectif', cle, source: s.length, produits: p.length, numeros: s.map(e => String(e.numero)), idProduits: p.map(x => x.idProduct) });
    }
    // les groupes (Gem Packs) : à l'intérieur de chaque clé, les effectifs par numéro de groupe doivent aussi concorder
    if (groupeDe) {
        for (const cle of toutes) {
            const s = parCleSource.get(cle) || [], p = parCleProduit.get(cle) || [];
            if (s.length !== p.length) continue;   // déjà signalé
            if (!p.every(x => x.numero != null && String(x.numero).trim() !== '')) continue;   // sans numéro Cardmarket, pas de témoin : le groupe est lu sur la source seule
            const gs = new Map(), gp = new Map();
            for (const e of s) compter(gs, String(groupeDe(String(e.numero))));
            for (const x of p) compter(gp, x.numero == null ? '(sans numéro)' : String(x.numero));
            const gk = new Set([...gs.keys(), ...gp.keys()]);
            for (const g of gk) if ((gs.get(g) || 0) !== (gp.get(g) || 0)) discordances.push({ type: 'groupe', cle, groupe: g, source: gs.get(g) || 0, produits: gp.get(g) || 0 });
        }
    }
    if (discordances.length) {
        const types = {}; for (const d of discordances) types[d.type] = (types[d.type] || 0) + 1;
        return refus(`${discordances.length} discordance(s) ${JSON.stringify(types)} : la preuve par le set ne s'applique pas`);
    }
    // ADMIS : les attributions
    const attributions = [], ambigus = [];
    for (const cle of toutes) {
        const s = parCleSource.get(cle), p = parCleProduit.get(cle);
        if (s.length === 1) { attributions.push({ idProduct: p[0].idProduct, numero: String(s[0].numero), niveau: 'exact', cle }); continue; }
        const groupes = groupeDe ? [...new Set(s.map(e => String(groupeDe(String(e.numero)))))] : [];
        if (groupes.length === 1) {
            // tous les numéros de la source portant ce nom sont dans UN groupe : le groupe du produit est lu sur la SOURCE (le numéro Cardmarket du produit, s'il est donné, n'a servi que de témoin)
            for (const x of p) attributions.push({ idProduct: x.idProduct, numero: groupes[0], niveau: 'groupe', candidats: s.map(e => String(e.numero)), cle });
        } else {
            ambigus.push({ cle, produits: p.map(x => x.idProduct), numeros: s.map(e => String(e.numero)) });
        }
    }
    attributions.sort((a, b) => a.idProduct - b.idProduct);
    return { admis: true, raison: `concordance totale : ${denominateurs.source} entrées / ${denominateurs.produits} produits, ${toutes.size} noms, effectifs égaux`, attributions, ambigus, discordances, denominateurs };
}

module.exports = { prouverParSet, cleProduitParDefaut };
