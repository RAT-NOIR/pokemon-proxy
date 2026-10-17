// ============================================================
// L'ARBITRAGE DES DÉSACCORDS BULBAPEDIA ↔ AUTRES SOURCES — un verdict écrit par ligne, par TÉMOINS indépendants (fonction PURE, lecture seule)
// ============================================================
// Entrée : une ligne de la confrontation (confronter-bulba.js) en désaccord SEUL (aucune source ne concorde). Sortie : « juste » (Bulbapedia a raison),
// « fausse » (+ correction proposée) ou « indecidable ». Rien n'est écrit : la correction est une PROPOSITION pour le lot suivant, qui exige le feu vert.
//
// RÈGLE DE PREUVE : une conclusion demande DEUX témoins — deux sources qui s'accordent, ou une source + une preuve STRUCTURELLE (un champ de la même fiche étranger
// au champ contesté, ou la table des noms de Pokédex). Un seul témoin ne tranche jamais (« indecidable »). Un champ de la fiche qui n'est pas unique par tirage
// (illustrateur d'un Dresseur, PV d'une réimpression) ne se corrige pas par une source qui lit UN autre tirage.
// ⚠️ La table des Pokédex (pokedex-dexids.json) vient de l'API TCGdex : TCGdex + table = MÊME lignée (`solidite: 'moyenne'`) ; pokemon-card.com ou pkmncards s'y
// ajoutant rendent la preuve `forte`. Le dire est le but : le lot de correction décide en connaissance de cause.
const { norm } = require('./confronter-bulba');

const tokens = s => String(s ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
// Noms différents d'une MÊME rareté (table fermée, deux cas observés : le nom de Bulbapedia ≠ celui de pkmncards / TCGdex pour la même catégorie imprimée)
const SYNONYMES_RARETE = { 'rare ace': 'ace spec rare', 'shining holo': 'rare shining' };
const canonRarete = s => { const t = String(s ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); return tokens(SYNONYMES_RARETE[t] || t); };

const cleValeur = v => Array.isArray(v) ? JSON.stringify(v.map(norm).sort()) : typeof v === 'number' ? String(v) : norm(v);
function distance(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
}
/** Deux listes d'attaques qui ne diffèrent que par l'orthographe (même longueur, chaque nom à distance ≤ 2 d'un nom de l'autre liste). */
const memeAttaquesAPeuPres = (A, S) => Array.isArray(A) && Array.isArray(S) && A.length === S.length && A.every(a => S.some(s => distance(norm(a), norm(s)) <= 2));

const indecidable = (raison, temoins = []) => ({ verdict: 'indecidable', raison, temoins });
const fausse = (raison, correction, temoins, solidite) => ({ verdict: 'fausse', raison, correction, temoins, ...(solidite ? { solidite } : {}) });
const juste = (raison, temoins) => ({ verdict: 'juste', raison, temoins });

/** Règle commune : deux sources (au moins) qui s'accordent entre elles contre Bulbapedia → fausse, sinon indécidable. */
function parMajorite(ko, raisonUnSeul = 'un seul témoin contredit Bulbapedia : insuffisant') {
    const groupes = new Map();
    for (const [src, x] of ko) { const k = cleValeur(x.valeur); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push([src, x.valeur]); }
    const accord = [...groupes.values()].filter(g => g.length >= 2).sort((a, b) => b.length - a.length)[0];
    if (accord) return fausse(`${accord.length} sources indépendantes s'accordent contre Bulbapedia`, accord[0][1], accord.map(([source, valeur]) => ({ source, valeur })));
    return indecidable(ko.length >= 2 ? 'les sources divergent entre elles' : raisonUnSeul, ko.map(([source, x]) => ({ source, valeur: x.valeur })));
}

function arbitrerNdex(l, ko, ctx) {
    const T = ctx.dexDuNom ? ctx.dexDuNom(l.contexte.nomEn) : null;
    if (!T) return parMajorite(ko, 'le nom n\'est pas dans la table des Pokédex et une seule source contredit');
    if (T.includes(Number(l.bulba))) return indecidable('la table des Pokédex SOUTIENT Bulbapedia, une source la contredit', [{ source: 'table-pokedex', valeur: T }, ...ko.map(([source, x]) => ({ source, valeur: x.valeur }))]);
    const concordantes = ko.filter(([, x]) => T.includes(Number(x.valeur)));
    if (!concordantes.length) return indecidable('la table des Pokédex contredit Bulbapedia, mais aucune source ne la rejoint', [{ source: 'table-pokedex', valeur: T }]);
    const forte = concordantes.some(([s]) => s === 'jp' || s === 'pkc');
    return fausse('la table des Pokédex et au moins une source donnent un autre numéro', concordantes[0][1].valeur,
        [...concordantes.map(([source, x]) => ({ source, valeur: x.valeur })), { source: 'table-pokedex', valeur: T }], forte ? 'forte' : 'moyenne');
}

// ── LES CONVENTIONS DE NOM DE RARETÉ : calibrées sur la population, jamais déduites d'une ligne.
// Bulbapedia dit « Ultra-Rare Rare » / « Rare VMAX » / « Rare Holo Prime », pkmncards ET TCGdex disent « Holo Rare V » / « Holo Rare VMAX » / « Rare Prime » : un vocabulaire, pas une
// rareté fausse. Elle se calibre PAR SOURCE (chacune a son vocabulaire), sur l'ensemble des impressions où la source parle : « X → Y » est retenue si
//   · AVANT : Bulbapedia X mène à Y au moins `purete` du temps (X est un nom de Y), ou
//   · ARRIÈRE : la source dit Y et Bulbapedia dit X au moins `purete` du temps (X est un nom plus GROSSIER de Y : « Ultra-Rare Rare » recouvre « Holo Rare V » et « Rare Holo GX »),
// sur au moins `minObs` impressions. Une valeur qui s'accorde AILLEURS (« Rare Holo » → « Rare » chez TCGdex : la moitié du temps) n'atteint pas la pureté : ce n'est pas un vocabulaire.
const cleConv = (de, vers) => tokens(de) + '→' + tokens(vers);
function calibrerConventions(lignes, { minObs = 8, purete = 0.95 } = {}) {
    const sortie = { pkc: {}, tdx: {} };
    for (const src of Object.keys(sortie)) {
        const totB = new Map(), totV = new Map(), paires = new Map();
        for (const l of lignes) {
            if (l.champ !== 'impression.rarete') continue;
            const x = l.parSource[src];
            if (!x || x.statut === 'abs' || x.valeur == null) continue;
            const kb = tokens(l.bulba), kv = tokens(x.valeur);
            totB.set(kb, (totB.get(kb) || 0) + 1); totV.set(kv, (totV.get(kv) || 0) + 1);
            if (kb === kv) continue;
            const kk = kb + '→' + kv; const o = paires.get(kk) || { de: l.bulba, vers: x.valeur, kb, kv, n: 0 }; o.n++; paires.set(kk, o);
        }
        for (const [kk, o] of paires) {
            const pf = o.n / totB.get(o.kb), pb = o.n / totV.get(o.kv), pu = Math.max(pf, pb);
            if (o.n >= minObs && pu >= purete) sortie[src][kk] = { de: o.de, vers: o.vers, observations: o.n, purete: Math.round(pu * 1000) / 1000, sens: pf >= pb ? 'avant' : 'arriere' };
        }
    }
    return sortie;
}

const holoVariants = v => { const s = new Set(v); return { holoSeul: s.has('holo') && !s.has('normal'), nonHolo: s.has('normal') && !s.has('holo') }; };
function arbitrerRarete(l, ko, ctx = {}) {
    const B = l.bulba;
    for (const [src, x] of ko) if (canonRarete(B) === canonRarete(x.valeur)) return juste('même rareté sous un autre nom (table de synonymes fermée)', [{ source: src, valeur: x.valeur }, { source: 'table-synonymes', valeur: SYNONYMES_RARETE }]);
    const holoB = /holo/i.test(B);
    const tdx = ko.find(([s]) => s === 'tdx'), pkc = ko.find(([s]) => s === 'pkc');
    // TCGdex agrège les raretés « Rare » : sa valeur « Rare » face à une rareté Bulbapedia plus fine ne dit RIEN (ni pour, ni contre)
    const tdxGrossier = !!tdx && norm(tdx[1].valeur) === 'rare' && /rare/i.test(B);
    // les contradictions que le vocabulaire de la source explique (convention calibrée) : si toutes le sont (TCGdex « Rare » restant neutre), Bulbapedia est cohérente
    const expliquees = ko.filter(([s, x]) => ctx.conventions && ctx.conventions[s] && ctx.conventions[s][cleConv(B, x.valeur)]);
    if (expliquees.length && ko.every(k => expliquees.includes(k) || (k === tdx && tdxGrossier))) {
        const c = ctx.conventions[expliquees[0][0]][cleConv(B, expliquees[0][1].valeur)];
        return { verdict: 'juste', raison: `convention de nom : « ${c.de} » chez Bulbapedia, « ${c.vers} » chez ${expliquees[0][0] === 'pkc' ? 'pkmncards' : 'TCGdex'} (${c.observations} impressions, pureté ${c.purete}, sens ${c.sens})`, temoins: expliquees.map(([source, x]) => ({ source, valeur: x.valeur })).concat([{ source: 'convention-calibree', valeur: c }]), normalisation: c.vers, convention: c };
    }
    if (holoB && (tdxGrossier || !tdx)) {
        const variants = tdx && tdx[1].extra && Array.isArray(tdx[1].extra.variants) ? holoVariants(tdx[1].extra.variants) : null;
        if (variants && variants.holoSeul) {
            if (pkc) return indecidable('pkmncards dit non-holo, les variantes TCGdex disent holo : deux sources divergent', [{ source: 'pkc', valeur: pkc[1].valeur }, { source: 'tdx.variants', valeur: tdx[1].extra.variants }]);
            return juste('TCGdex n\'agrège que « Rare » et ses variantes sont holo seules : Bulbapedia est cohérente', [{ source: 'tdx', valeur: tdx[1].valeur }, { source: 'tdx.variants', valeur: tdx[1].extra.variants }]);
        }
        if (variants && variants.nonHolo) {
            const corr = pkc ? pkc[1].valeur : tdx[1].valeur;
            return fausse('les variantes TCGdex ne contiennent aucune version holo', corr, [pkc ? { source: 'pkc', valeur: pkc[1].valeur } : { source: 'tdx', valeur: tdx[1].valeur }, { source: 'tdx.variants', valeur: tdx[1].extra.variants }], pkc ? 'forte' : 'moyenne');
        }
        if (!pkc) return indecidable('TCGdex n\'agrège que « Rare » et ne dit rien du holo : source trop grossière', tdx ? [{ source: 'tdx', valeur: tdx[1].valeur }] : []);
    }
    const fines = ko.filter(([s, x]) => !(s === 'tdx' && tdxGrossier));
    return parMajorite(fines, 'une seule source fine contredit : insuffisant');
}

/**
 * @param {object} l    ligne de confronter-bulba.js
 * @param {{dexDuNom?:(nom:string)=>number[]|null}} ctx
 * @returns {{verdict:'juste'|'fausse'|'indecidable'|'sans-objet', raison:string, temoins:object[], correction?:*, solidite?:string}}
 */
function arbitrer(l, ctx = {}) {
    const sources = Object.entries(l.parSource || {});
    if (l.statut !== 'desaccord' || sources.some(([, x]) => x.statut === 'ok' || x.statut === 'approx')) return { verdict: 'sans-objet', raison: 'pas un désaccord seul', temoins: [] };
    const ko = sources.filter(([, x]) => x.statut === 'ko');
    if (!ko.length) return { verdict: 'sans-objet', raison: 'aucune source ne contredit', temoins: [] };
    switch (l.champ) {
        case 'carte.ndex': return arbitrerNdex(l, ko, ctx);
        case 'impression.rarete': return arbitrerRarete(l, ko, ctx);
        case 'carte.illustrateur':
            if (l.contexte.categorie && l.contexte.categorie !== 'pokemon') return indecidable('l\'illustrateur d\'un Dresseur ou d\'une Énergie est celui d\'un tirage : le champ de la carte est unique, les tirages sont réillustrés', ko.map(([source, x]) => ({ source, valeur: x.valeur })));
            return parMajorite(ko);
        case 'carte.attaques':
            if (ko.some(([, x]) => memeAttaquesAPeuPres(l.bulba.map(a => (typeof a === 'string' ? a : a.nom)), x.valeur))) return indecidable('variante orthographique des noms d\'attaque : rien ne dit quelle écriture est imprimée', ko.map(([source, x]) => ({ source, valeur: x.valeur })));
            return parMajorite(ko);
        case 'set.totalImprime': {
            // Bulbapedia compte les cartes du set (secrètes comprises) ; les sources rangent parfois la Trainer Gallery ou le Shiny Vault à part : un grand écart est un PÉRIMÈTRE, pas une faute
            const r = parMajorite(ko);
            if (r.verdict === 'fausse' && Math.abs(Number(r.correction) - Number(l.bulba)) > 2) return indecidable('l\'écart dépasse 2 cartes : le périmètre du set (Trainer Gallery, Shiny Vault…) diffère selon les sources', r.temoins);
            return r;
        }
        default: return parMajorite(ko);
    }
}

/** Arbitre toutes les lignes en désaccord seul. @returns {{entrees:object[], resume:Object}} */
function arbitrerTout(lignes, ctx) {
    const entrees = [], resume = {};
    for (const l of lignes) {
        if (l.statut !== 'desaccord') continue;
        const a = arbitrer(l, ctx);
        if (a.verdict === 'sans-objet') continue;
        entrees.push({ champ: l.champ, cle: l.cle, contexte: l.contexte, bulba: l.bulba, sources: Object.fromEntries(Object.entries(l.parSource).filter(([, x]) => x.valeur != null).map(([s, x]) => [s, x.valeur])), ...a });
        const r = (resume[l.champ] ||= { total: 0, juste: 0, fausse: 0, indecidable: 0 });
        r.total++; r[a.verdict]++;
    }
    return { entrees, resume };
}

module.exports = { arbitrer, arbitrerTout, calibrerConventions, SYNONYMES_RARETE };
