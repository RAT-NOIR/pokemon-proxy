// ============================================================
// L'UNIVERS DES EXPANSIONS — le dénominateur de « toutes les cartes », 0 requête
// ============================================================
//   node collecte-cartes/univers-expansions.js   -> écrit collecte-cartes/univers-expansions.json + imprime le bilan
//
// Objectif du testeur (2026-09-15) : le catalogue sert l'API de reconnaissance d'images de Rat-Market, TOUTES les cartes
// doivent y être. Chaque idExpansion de `numeros_cartes` (production, lecture seule) reçoit UN état et une cause :
//   collecte-ok · faux-affirme · a-regarder (raisons) · verifiee-non-collectee · non-verifiee · echec
//   absente-des-tables : langue (chinois, coréen, thaï, indonésien) · sans-slugSet · non-appariee
// et sa famille de langue : japonais · occidental · chinois-simplifie · chinois-traditionnel · autre-asiatique · inconnue.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs'), path = require('path');
const { ouvrirConnexions } = require('./garde');
const { TABLE_MAIN, TABLE_AUTO } = require('./table-sets');

// Même motif que generer-table-auto.js (langueAsiatique), ÉCRIT EN FAMILLES : le chinois se sépare du reste.
function familleAsiatique(codeSet, slugSet) {
    const c = String(codeSet || ''), s = String(slugSet || '');
    if (/^CS.*C$/.test(c) || /^CBB\d+C$/.test(c) || c === '151C' || /\/CS$/.test(c) || /Simplified-Chinese|Chinese(?!-Traditional)/i.test(s)) return 'chinois-simplifie';
    if (/\/CT$/.test(c) || c === 'PKMTCH' || /Traditional-Chinese|Taiwan|Hong-Kong/i.test(s)) return 'chinois-traditionnel';
    if (/\/(ID|TH)$/.test(c) || /Indonesian|Thai|IDTH|Korean/i.test(s)) return 'autre-asiatique';
    return null;
}

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    // ⚠️ L'ÉTAT SE LIT, IL NE SE SUPPOSE PAS. Cette ligne disait « les 38 lignes à la main sont
    // collectées (2026-09-12) » et l'écrivait en dur : vrai ce jour-là, faux dès qu'une ligne à la
    // main est ajoutée (les 10 « Additionals » occidentales du 2026-09-19). C'est la famille du §21 —
    // un résultat plausible que rien ne contredit. On lit `collecte_etat`.
    const phases = new Map((await cx.db.collection('collecte_etat').find({}, { projection: { phase: 1 } }).toArray()).map(e => [e._id, e.phase]));
    const parExp = await prod.db.collection('numeros_cartes').aggregate([
        { $match: { idExpansion: { $ne: null } } },
        { $group: { _id: { exp: '$idExpansion', slugSet: '$slugSet' }, n: { $sum: 1 } } },
        // 🔴 « LE PLUS FRÉQUENT » CHOISIT L'ABSENCE QUAND L'ABSENCE EST FRÉQUENTE — mesuré le 2026-09-20.
        // Le tri par effectif seul mettait `null` en tête pour `mC` : **473 lignes sans slugSet contre 301
        // qui portent « MEGA-Start-Deck-100-Battle-Collection »**. L'expansion entière était donc rangée
        // « sans slugSet » et écartée de TOUS les appariements — 774 produits — alors que son nom était
        // écrit, lisiblement, sur 301 de ses lignes. C'est le §6 (une colonne qu'un chemin d'apprentissage
        // n'écrit pas) transformé en verdict d'expansion par une règle de majorité.
        // ⚠️ Un `null` n'est pas une valeur candidate : il ne peut PAS gagner un vote contre une valeur
        // réelle. Le tri place donc les lignes renseignées d'abord, l'effectif ne départage qu'entre elles.
        // 🔴 ET LA PREMIÈRE VERSION DE CE TEST NE VOYAIT RIEN : `{ $in: ['$_id.slugSet', [null, '']] }`.
        // Quand le champ est ABSENT du document, `$group` ne met PAS la clé dans `_id` — il rend
        // `{"_id":{"exp":6381},"n":473}`, sans `slugSet` du tout. `$_id.slugSet` vaut alors « manquant »,
        // que `$in` ne trouve ni égal à `null` ni égal à `''` : les deux groupes sortaient « renseignés »
        // et l'effectif reprenait la main. **Absent, `null` et `''` sont TROIS choses dans une agrégation**
        // — c'est l'erreur #8 (§3) à l'intérieur d'une expression Mongo. `$ifNull` couvre les trois.
        { $addFields: { renseigne: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$_id.slugSet', ''] } }, 0] }, 1, 0] } } },
        { $sort: { renseigne: -1, n: -1 } },
        { $group: { _id: '$_id.exp', slugSet: { $first: '$_id.slugSet' }, produits: { $sum: '$n' } } }
    ]).toArray();
    const codes = new Map((await prod.db.collection('codes_set').find({}).toArray()).map(c => [c.idExpansion, c]));
    const main = new Map(TABLE_MAIN.map(l => [l.exp, l])), auto = new Map(TABLE_AUTO.map(l => [l.exp, l]));
    const univers = parExp.map(e => {
        const c = codes.get(e._id), m = main.get(e._id), a = auto.get(e._id), l = m || a;
        const asia = familleAsiatique(c?.codeSet, e.slugSet);
        const famille = asia || (l?.region === 'japonais' || l?.bulba?.tirage === 'jp' ? 'japonais' : l?.region === 'occidental' || l?.bulba?.tirage === 'intl' ? 'occidental' : c?.region || 'inconnue');
        let etat, cause = null;
        if (m) etat = phases.get(m.slugSet) === 'verifie' ? 'collecte-ok' : (etat = 'verifiee-non-collectee', cause = `ligne à la main, texte ${phases.get(m.slugSet) || 'jamais collecté'}`, etat);
        else if (a) {
            const ce = a.collecte?.etat;
            if (ce === 'ok' || ce === 'faux-affirme') etat = ce === 'ok' ? 'collecte-ok' : 'faux-affirme';
            else if (ce?.startsWith('echec')) etat = 'echec';
            else if (a.verif && !a.verifie) { etat = 'a-regarder'; cause = a.verif.raisons.join(' ; '); }
            else if (a.verifie) etat = 'verifiee-non-collectee';
            else etat = 'non-verifiee';
        } else { etat = 'absente-des-tables'; cause = asia ? `langue ${asia}` : !e.slugSet ? 'sans slugSet' : 'non appariée (ambiguë ou sans page « <slug> (TCG) »)'; }
        return { exp: e._id, slugSet: e.slugSet ?? null, codeSet: c?.codeSet ?? null, regionCodesSet: c?.region ?? null, produits: e.produits, code: l?.code ?? null, famille, etat, cause };
    });
    fs.writeFileSync(path.join(__dirname, 'univers-expansions.json'), JSON.stringify(univers, null, 1));
    const somme = xs => xs.reduce((t, x) => t + x.produits, 0);
    console.log(`DÉNOMINATEUR : ${univers.length} idExpansion · ${somme(univers)} produits`);
    const familles = [...new Set(univers.map(u => u.famille))];
    for (const f of familles) {
        const xs = univers.filter(u => u.famille === f);
        const parEtat = [...new Set(xs.map(u => u.etat))].map(e => { const ys = xs.filter(u => u.etat === e); return `${e} ${ys.length} (${somme(ys)} p)`; });
        console.log(`  ${f.padEnd(21)} ${String(xs.length).padStart(3)} exp · ${String(somme(xs)).padStart(6)} p · ${parEtat.join(' · ')}`);
    }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
