// ============================================================
// LA TABLE FERMÉE D'ALIAS DE SETS (Bulbapedia ↔ pkmncards / TCGdex / pokemon-card.com) — chaque alias est PROUVÉ, jamais deviné
// ============================================================
// Bulbapedia nomme une expansion autrement que la source (« Hidden Fates » / « Hidden Fates » + « Shiny Vault », « SM-P Promotional cards » / « SM-P », « Pokémon Card 151 » / « sv2a »).
// Un nom qui ne concorde pas rend l'impression « non résolue » : la comparaison se TAIT (et un silence coûte, §30). L'alias se prouve par le RECOUVREMENT (numéro, nom)
// du set ENTIER, dans les deux sens :
//   · jamais le numéro seul (§31 : sur des plages denses de petits entiers, toute expansion couvre toute autre) — le nom doit concorder au même numéro ;
//   · couverture de Bulbapedia ≥ 0,8 ET de la source ≥ 0,5 (même set, vu des deux côtés), OU la source est presque entièrement contenue (≥ 0,8) : une expansion Bulbapedia peut
//     être la réunion de plusieurs sets de la source (Hidden Fates + Shiny Vault) — chaque partie se prouve alors seule, et les parties doivent être DISJOINTES ;
//   · deux candidats qui se chevauchent à taille comparable : ambigu, AUCUN n'est choisi ;
//   · au moins `minPaires` paires distinctes : en dessous, la preuve est trop mince et l'impression reste sans remplaçant (un trou nommé, pas une devinette).
// ⚠️ Le nom reste un TÉMOIN à l'usage : l'alias ne donne que le set ; chaque impression se confirme encore par SON nom (confronter-bulba.js : nomDiff).
// Ce module est pur. La table (alias-sets-bulba.json) est produite par mesurer-alias-sets.js ; `verifierTable` la refuse si une entrée n'a pas sa preuve au niveau des seuils.
const { norm, cn } = require('./confronter-bulba');

const SEUILS = { minPaires: 5, couvBulbaMin: 0.8, couvExterneMin: 0.5, couvExterneContenue: 0.8, rivalMin: 0.5 };

const cleNum = n => cn(n);
const clePaire = (num, nom) => cleNum(num) + '\u0000' + norm(nom);

/** Index inversé des sets externes : paire (numéro, nom) → clés de sets ; taille (numéros distincts) par set. @param {{cle:string, cartes:{numero:*, nom:string}[]}[]} candidats */
function indexerExternes(candidats) {
    const paires = new Map(), tailles = new Map();
    for (const c of candidats) {
        const nums = new Set();
        for (const k of c.cartes) {
            const n = cleNum(k.numero); if (n === null || !norm(k.nom)) continue;
            nums.add(n);
            const p = clePaire(k.numero, k.nom);
            if (!paires.has(p)) paires.set(p, new Set());
            paires.get(p).add(c.cle);
        }
        tailles.set(c.cle, nums.size);
    }
    return { paires, tailles };
}

/**
 * @param {{numero:*, nom:string}[]} bulba  les (numéro, nom) de l'expansion Bulbapedia
 * @returns {{retenus:{cle:string, paires:number, couvBulba:number, couvExterne:number}[], refus:null|'trop-peu'|'aucun-candidat'|'ambigu', evalues:object[]}}
 */
function prouverAlias(bulba, index, seuils = SEUILS) {
    const numsB = new Set(); const vus = new Set();
    const hist = new Map();   // cle -> Set(numéros appariés)
    for (const k of bulba) {
        const n = cleNum(k.numero); if (n === null || !norm(k.nom)) continue;
        numsB.add(n);
        const p = clePaire(k.numero, k.nom); if (vus.has(p)) continue; vus.add(p);
        for (const cle of index.paires.get(p) || []) { if (!hist.has(cle)) hist.set(cle, new Set()); hist.get(cle).add(n); }
    }
    if (numsB.size < seuils.minPaires) return { retenus: [], refus: 'trop-peu', evalues: [] };
    const r3 = x => Math.round(x * 1000) / 1000;
    const evalues = [...hist.entries()].map(([cle, nums]) => {
        const taille = index.tailles.get(cle) || nums.size;
        return { cle, nums, paires: nums.size, couvBulba: r3(nums.size / numsB.size), couvExterne: r3(nums.size / taille) };
    }).sort((a, b) => b.paires - a.paires || b.couvExterne - a.couvExterne || (a.cle < b.cle ? -1 : 1));
    const eligible = e => e.paires >= seuils.minPaires && ((e.couvBulba >= seuils.couvBulbaMin && e.couvExterne >= seuils.couvExterneMin) || e.couvExterne >= seuils.couvExterneContenue);
    const el = evalues.filter(eligible);
    const sortie = (retenus, refus) => ({ retenus: retenus.map(({ cle, paires, couvBulba, couvExterne }) => ({ cle, paires, couvBulba, couvExterne })), refus, evalues: evalues.slice(0, 3).map(({ cle, paires, couvBulba, couvExterne }) => ({ cle, paires, couvBulba, couvExterne })) });
    if (!el.length) return sortie([], 'aucun-candidat');
    const retenus = [el[0]]; const pris = new Set(el[0].nums);
    for (const e of el.slice(1)) {
        const chevauche = [...e.nums].some(n => pris.has(n));
        if (!chevauche) { retenus.push(e); e.nums.forEach(n => pris.add(n)); continue; }
        if (e.paires >= seuils.rivalMin * el[0].paires) return sortie([], 'ambigu');   // un rival de taille comparable : on ne choisit pas
    }
    return sortie(retenus, null);
}

/** La table est FERMÉE : chaque entrée doit porter sa preuve (paires, couvertures) au niveau des seuils, sinon elle est rejetée. Rend la liste des erreurs. */
function verifierTable(table, seuils = SEUILS) {
    const erreurs = [];
    const preuveOk = p => p && Number.isFinite(p.paires) && Number.isFinite(p.couvBulba) && Number.isFinite(p.couvExterne) && typeof p.cle === 'string' && p.cle.length > 0
        && p.paires >= seuils.minPaires && ((p.couvBulba >= seuils.couvBulbaMin && p.couvExterne >= seuils.couvExterneMin) || p.couvExterne >= seuils.couvExterneContenue);
    const verifier = (quoi, cle, liste) => {
        if (!Array.isArray(liste) || !liste.length) { erreurs.push(`${quoi} ${cle} : aucune preuve`); return; }
        for (const p of liste) if (!preuveOk(p)) erreurs.push(`${quoi} ${cle} : preuve absente ou sous les seuils (${JSON.stringify(p)})`);
    };
    for (const [k, e] of Object.entries(table.intl || {})) {
        if (!e.pkc && !e.tdx) erreurs.push(`intl ${k} : aucune source`);
        if (e.pkc) verifier('intl/pkc', k, e.pkc);
        if (e.tdx) verifier('intl/tdx', k, e.tdx);
    }
    for (const [k, e] of Object.entries(table.jp || {})) verifier('jp', k, e.dossiers);
    return erreurs;
}

/** La forme que lit confronter-bulba.js : alias.intl[normExpansion] = { pkc:[clés], tdx:[clés] } · alias.jp[normExpansion] = [dossiers]. */
function versTableConfronter(table) {
    const intl = {}, jp = {};
    for (const [k, e] of Object.entries(table.intl || {})) { const o = {}; if (e.pkc) o.pkc = e.pkc.map(x => x.cle); if (e.tdx) o.tdx = e.tdx.map(x => x.cle); intl[k] = o; }
    for (const [k, e] of Object.entries(table.jp || {})) jp[k] = (e.dossiers || []).map(x => x.cle);
    return { intl, jp };
}

module.exports = { indexerExternes, prouverAlias, verifierTable, versTableConfronter, SEUILS, clePaire };
