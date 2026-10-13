// ============================================================
// LES SETS QUE PIKAQIAN SERT — une ligne par set zh-hans de notre base ; ÉCRITE PAR CE QU'ELLE AUTORISE (§51)
// ============================================================
// Générée le 2026-10-11 depuis la MESURE du 2026-10-10 (MESURE-PIKAQIAN.md §6-7) et la lecture seule de la base `cartes` (sets au tirage
// `zh-hans`, leur code Cardmarket `sets.code`, leurs produits joints) : 95 sets au tirage zh-hans, 91 dont le code a une page chez pikaqian.
// `codePk` : le code que pikaqian écrit dans l'adresse — le code Cardmarket en minuscules (CSV10C → csv10c, CS1bC → cs1bc, 151C → 151c,
// CSM2.5C → csm2.5c), les promos sous `promo-*` (SV-P/CS → promo-sv-p). Un code ne se traduit pas (§39).
// 🕳️ Sans page chez pikaqian, donc sans ligne (trous nommés) : CSMPC Battle Party Set (305 produits joints), CSVM1C Master Strategy (82),
// CSVM2 Master Strategy Vol. 2 (97), 30thDC 30th Celebration Premium Deck Set (45).
// 🔑 Seules 3 pages sont MESURÉES (CSV10C, CS1bC, 151C : 675 appariés sur 678) ; les 88 autres ne le sont pas, et leur appariement n'est pas
// promis — la PREUVE par produit (collecte-cartes/pikaqian.js) décide à chaque collecte, un doute est un trou. La garde de la page est
// la majorité de ses tuiles au code du set (`verdictDePage`), pas un nombre de cartes qu'on n'a pas mesuré.
// `trous` : les produits joints le 2026-10-11, pour l'ordre de passage (plus gros d'abord) — jamais une promesse.
const lignes = require('./pikaqian-sets.json');
const TABLE_PIKAQIAN = Object.freeze(lignes.map(l => Object.freeze({ ...l, site: 'pikaqian' })));
const lignePikaqian = slug => TABLE_PIKAQIAN.find(l => l.slug === slug) || null;
/** L'unité de file d'une ligne — la forme que l'outil d'enfilage insère et que la garde du collecteur (`releve`) accepte, mot pour mot. */
const uniteDeLaLigne = L => ({ _id: `pikaqian/${L.slug}`, source: 'pikaqian', slugSet: L.slug, code: L.code, codePk: L.codePk, langue: L.langue, trous: L.trous });

// ── CE QU'UNE LIGNE DÉCLARE DE SA PAGE (lot PQ-PROMO, 2026-10-13) ─────────────────────────────────────────────────────────────────────
// 🔑 LA FONCTION UNIQUE. Une page promo (promo-sv-p…) range ses tuiles sous d'autres codes que celui de son adresse, et ses images sous un autre dossier : la garde « la majorité
// des tuiles porte le code du set » la refusait. Une ligne peut donc DÉCLARER, à partir d'une mesure écrite (`mesure`), ce que SA page porte :
//   · `codesTuiles`    : liste FERMÉE des codes que ses tuiles portent ;
//   · `dossiersImages` : liste fermée des dossiers de `images.pikaqian.com/<dossier>/<id>.webp` ;
//   · `titrePk`        : le titre exact que la page porte (`<h1>`, à défaut `<title>`) ;
//   · `tuiles`         : le nombre de tuiles relevé (la page n'est jamais plus petite).
// La déclaration est TOUT OU RIEN : une seule de ces clés posée sans les autres (ou sans `mesure`) est une déclaration incomplète, et la page est REFUSÉE. Une ligne qui ne déclare
// rien garde exactement le comportement d'avant (le code de l'adresse, seul, pour les tuiles et pour le dossier). CETTE fonction est la seule à lire ces champs : verdictDePage,
// planifierPikaqian, imageAcceptee (collecte-cartes/pikaqian.js), et par eux le récepteur, le plan des fiches apprises, l'import et le collecteur — jamais une copie (§21 bis).
const CODE_PK = /^[a-z0-9][a-z0-9.-]{0,30}$/;
const CLES_DECLARATION = ['codesTuiles', 'dossiersImages', 'titrePk'];
const listeFermee = (v, nom) => {
    if (!Array.isArray(v) || !v.length) return `${nom} doit être une liste non vide`;
    const mauvais = v.find(x => typeof x !== 'string' || !CODE_PK.test(x));
    return mauvais === undefined ? null : `${nom} : « ${String(mauvais).slice(0, 40)} » hors du motif des codes (minuscules, chiffres, point, tiret)`;
};
/**
 * @param {string} codePk le code de l'ADRESSE de la page (`/sets/<codePk>`)
 * @param {object[]} [table] la table (les bancs seuls en passent une)
 * @returns {{codePk:string, declare:boolean, valide:boolean, motif:string|null, codes:string[], dossiers:string[], titre:string|null, tuiles:number|null}}
 */
function declarationsDeCode(codePk, table = TABLE_PIKAQIAN) {
    const lignesDuCode = table.filter(l => l.codePk === codePk);
    const declarantes = lignesDuCode.filter(l => CLES_DECLARATION.some(k => l[k] !== undefined && l[k] !== null));
    const tuiles = lignesDuCode.filter(l => Number.isInteger(l.tuiles)).reduce((m, l) => Math.max(m, l.tuiles), 0) || null;
    const base = { codePk, declare: false, valide: true, motif: null, codes: [codePk], dossiers: [codePk], titre: null, tuiles };
    if (!declarantes.length) return base;
    const l = declarantes[0];
    // une déclaration refusée rend quand même ce qu'elle déclare (valide: false) : c'est la garde de l'appelant qui refuse, et le banc la voit tomber si on la retire
    const chaines = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && CODE_PK.test(x)) : []);
    const refus = motif => ({ ...base, declare: true, valide: false, motif: `déclaration incomplète ou illisible pour ${codePk} : ${motif}`,
        codes: [...new Set([codePk, ...chaines(l.codesTuiles)])], dossiers: [...new Set([codePk, ...chaines(l.dossiersImages)])], titre: typeof l.titrePk === 'string' ? l.titrePk : null });
    if (lignesDuCode.length > 1) return refus(`${lignesDuCode.length} lignes portent ce codePk : une déclaration ne se partage pas`);
    if (typeof l.mesure !== 'string' || !l.mesure.trim()) return refus('`mesure` (la preuve écrite des valeurs déclarées) manque');
    if (typeof l.titrePk !== 'string' || !l.titrePk.trim()) return refus('`titrePk` manque ou est vide');
    if (!Number.isInteger(l.tuiles) || l.tuiles < 1) return refus('`tuiles` (le nombre relevé) manque : un titre sans nombre de tuiles ne prouve pas que la page est complète');
    const e = listeFermee(l.codesTuiles, '`codesTuiles`') || listeFermee(l.dossiersImages, '`dossiersImages`');
    if (e) return refus(e);
    return { ...base, declare: true, codes: [...new Set([codePk, ...l.codesTuiles])], dossiers: [...new Set([codePk, ...l.dossiersImages])], titre: l.titrePk, tuiles: l.tuiles };
}
module.exports = { TABLE_PIKAQIAN, lignePikaqian, uniteDeLaLigne, declarationsDeCode, CODE_PK };
