// Lot CVIPER, partie 1 — les sets japonais NON SERVIS, triés par GAIN pour une collecte passive de Collectorviper.
// LECTURE SEULE, ZÉRO REQUÊTE : l'entrée est la mesure déjà faite (S7\COUV\final\tous.json), la table des codes est celle du dépôt.
//   node collecte-cartes/gain-collectorviper.js --entree=<tous.json> --sortie=<dossier>
//
// GAIN = produits `jp` NON servis qu'une image juste rendrait servis, c'est-à-dire ceux qui ONT une fiche : causes 9 (source de set), 4 (image présente, numéro),
// 7 (image refusée, état), 8 (image trouvée, non appariée). Un produit SANS fiche (cause 2) ne gagne rien par une image : compté à part. La cause 3 (ligne hors
// présentation, non attribué) n'est ni l'un ni l'autre : comptée à part aussi. 🔑 La liste des causes du gain est ÉCRITE par ce qu'elle autorise (ce petit ensemble) ;
// tout autre non-servi tombe dans sansFiche, horsGain ou sansCause, et la concordance totaux = non servis est vérifiée par le banc.
//
// L'ÈRE se lit sur NOS données : le code du set dans la table (table-sets, auto, sans page), puis la forme du slug pour reconnaître un deck. Le NOM d'un set ne prouve
// jamais une ère à lui seul (« Sun-Moon-Foo » reste inconnu). Ce qui ne se prouve pas est « ère inconnue » (couvert = null) : jamais rangé dans « annoncé » ni dans
// « non annoncé ».
// Les ères ANNONCÉES par Collectorviper (brief du lot) : Neo, VS, WEB, e, ADV, PCG, DP/DPt, Legend, BW, XY, SM, promos 1996-2017, decks. Les sets modernes (S, SV, M),
// avant-Neo (Base, Gym) ne figurent pas dans cette liste : couvert = false (ce n'est pas « absent chez la source », c'est « non annoncé »).
const fs = require('fs');
const path = require('path');

const CAUSES_GAIN = Object.freeze([9, 4, 7, 8]);
const CAUSE_SANS_FICHE = 2;
const ERES_ANNONCEES = Object.freeze(['Neo', 'VS', 'WEB', 'e', 'ADV', 'PCG', 'DP/DPt', 'Legend', 'BW', 'XY', 'SM', 'promos 1996-2017', 'decks']);
const INCONNUE = 'ère inconnue', MODERNE = 'moderne (S, SV, M)', PRE_NEO = 'avant Neo (Base, Gym)', PROMOS_MODERNES = 'promos modernes';

// (code → ère) pour les sets qui ne sont pas des decks ; ordre = priorité. Le code vient de la table, jamais du nom.
const REGLES_CODE = [
    [/^(ADV|PCG|L|BW|XY|SM)-P$/, 'promos 1996-2017'],
    [/^(SV|S|M)-P$/, PROMOS_MODERNES],
    [/^(IPN[A-Z]?|N[1-4])$/, 'Neo'],
    [/^VS$/, 'VS'],
    [/^WEB$/, 'WEB'],
    [/^(EC\d|E[1-5])$/, 'e'],
    [/^ADV\d?[a-z]?$/, 'ADV'],
    [/^PCG\d[a-z]?$/, 'PCG'],
    [/^(DP\d[a-z]?|DPt\d?|Pt\d)$/, 'DP/DPt'],
    [/^L(\d[A-Z]*|L)$/, 'Legend'],
    [/^BW\d[a-z]*$/, 'BW'],
    [/^(BXY|XY\d[a-z]?)$/, 'XY'],
    [/^sm\d+[a-z+]*$/, 'SM'],
    [/^(sv|sp|sI|sN)/, MODERNE],
    [/^s\d/, MODERNE],
    [/^m([A-Z0-9]|\d)/, MODERNE],
    [/^(EXP|G1|G2|GTG|CG[A-Z])$/, PRE_NEO]
];
// un deck se reconnaît à la forme de son slug (liste fermée) ; sa sous-ère se prouve par le code, sinon par la famille de nom moderne
// MOTS ENTIERS, CASSE COMPRISE (« Kit » dans « Skittykit » n'est pas un kit) ; le slug est coupé aux tirets
const MOTS_DECK = Object.freeze(['Deck', 'Decks', 'Starter', 'Kit', 'Box', 'Boxes', 'Construction', 'Constructed', 'Intro']);
const estDeckDeSlug = slug => String(slug).split('-').some(m => MOTS_DECK.includes(m));
const REGLES_DECK_CODE = [
    [/^IPN[A-Z]?$/, 'Neo'],
    [/^pcg[A-Z]$/, 'PCG'],
    [/^(Pt[A-Z]{1,2}|DPt[A-Z]|DP3[pd])$/, 'DP/DPt'],
    [/^L2[st]$/, 'Legend'],
    [/^XY[a-z]$/, 'XY'],
    [/^sm[A-Z]$/, 'SM'],
    [/^(sv|sp|sI|sN|s[A-Z]|s\d|m[A-Z0-9])/, MODERNE]
];

function ereDe({ slug, code, nom }) {
    const c = typeof code === 'string' ? code : '';
    const s = String(slug ?? nom ?? '');
    const estDeck = estDeckDeSlug(s);
    if (c) {
        if (estDeck) {
            for (const [re, sous] of REGLES_DECK_CODE) if (re.test(c)) return { ere: 'decks', sousEre: sous, couvert: sous !== MODERNE, preuve: `deck, code ${c}` };
        }
        for (const [re, ere] of REGLES_CODE) if (re.test(c)) {
            const couvert = ERES_ANNONCEES.includes(ere);
            return { ere, sousEre: null, couvert, preuve: `code ${c}` };
        }
    }
    // 🔑 sans code reconnu dans la table, le NOM d'un set ne prouve aucune ère (brief : « l'ère se lit sur nos données ») : ère inconnue, deck ou non
    return { ere: INCONNUE, sousEre: null, couvert: null, preuve: c ? `code ${c} non reconnu` : 'aucun code dans la table' };
}

/** slug → ['site (code)', …] LU dans TABLE_TPC (collecte-cartes/tpc-sets.js) : les sets qu'une autre source (TPC Asie, pokemon-card.com) vise déjà. Jamais recopié. */
function autresSourcesDe(tableTpc) {
    const m = new Map();
    for (const l of tableTpc) { const a = m.get(l.slug) || []; a.push(`${l.site} (${l.code})`); m.set(l.slug, a); }
    return m;
}

function calculer(lignes, codesParSlug, autresSources = new Map()) {
    if (!Array.isArray(lignes) || !(codesParSlug instanceof Map)) throw new Error('calculer : lignes (tableau) et table des codes (Map) exigées');
    const jp = lignes.filter(x => x.langue === 'jp');
    if (!jp.length) throw new Error(`aucune ligne jp parmi ${lignes.length} lignes : population vide, pas un zéro (champ « langue » mal lu ?)`);
    const nonServis = jp.filter(x => !x.servi);
    if (nonServis.length && codesParSlug.size === 0) throw new Error('la table des codes est vide alors que des sets existent : lecture de la table en échec');
    const sets = new Map();
    const totaux = { gain: 0, sansFiche: 0, horsGain: 0, sansCause: 0, gainCouvert: 0, gainHorsAnnonce: 0, gainEreInconnue: 0, gainAutreSource: 0 };
    for (const x of nonServis) {
        let s = sets.get(x.slug);
        if (!s) {
            const code = codesParSlug.get(x.slug) || null;
            const e = ereDe({ slug: x.slug, code: code || undefined, nom: x.nomSet });
            s = { slug: x.slug, nom: x.nomSet, code, ere: e.ere, sousEre: e.sousEre, couvert: e.couvert, preuveEre: e.preuve, autresSources: autresSources.get(x.slug) || [], gain: 0, sansFiche: 0, horsGain: 0, sansCause: 0, nonServis: 0 };
            sets.set(x.slug, s);
        }
        s.nonServis++;
        if (CAUSES_GAIN.includes(x.cause)) { s.gain++; totaux.gain++; if (s.autresSources.length) totaux.gainAutreSource++; if (s.couvert === true) totaux.gainCouvert++; else if (s.couvert === false) totaux.gainHorsAnnonce++; else totaux.gainEreInconnue++; }
        else if (x.cause === CAUSE_SANS_FICHE) { s.sansFiche++; totaux.sansFiche++; }
        else if (typeof x.cause === 'number') { s.horsGain++; totaux.horsGain++; }
        else { s.sansCause++; totaux.sansCause++; }
    }
    const liste = [...sets.values()].sort((a, b) => b.gain - a.gain || b.sansFiche - a.sansFiche || a.slug.localeCompare(b.slug));
    const parEre = new Map();
    for (const s of liste) {
        const cle = s.sousEre ? `${s.ere} / ${s.sousEre}` : s.ere;   // un deck se range sous sa sous-ère : « annoncée » se décide par elle, pas par le premier deck vu
        const o = parEre.get(cle) || { ere: cle, couvert: s.couvert, sets: 0, gain: 0, sansFiche: 0 };
        o.sets++; o.gain += s.gain; o.sansFiche += s.sansFiche; parEre.set(cle, o);
    }
    const eres = [...parEre.values()].sort((a, b) => b.gain - a.gain || a.ere.localeCompare(b.ere));
    return { denominateur: { lignes: lignes.length, jpTotal: jp.length, jpNonServis: nonServis.length, sets: liste.length }, causesGain: [...CAUSES_GAIN], eresAnnoncees: [...ERES_ANNONCEES], totaux, sets: liste, eres };
}

function rendreMd(R) {
    const d = R.denominateur, t = R.totaux;
    const L = [];
    L.push('# Gain Collectorviper — sets japonais non servis, triés par gain', '');
    L.push(`Dénominateur : ${d.lignes} lignes, ${d.jpTotal} produits jp, **non servis jp : ${d.jpNonServis}** dans ${d.sets} sets.`);
    L.push(`Gain (causes ${R.causesGain.join(', ')}, produits AVEC fiche) : **${t.gain}**. Sans fiche (cause 2, à part) : ${t.sansFiche}. Hors gain (cause 3) : ${t.horsGain}. Sans cause : ${t.sansCause}.`);
    L.push(`Du gain, **couverts par une ère annoncée** par Collectorviper : ${t.gainCouvert} ; ère non annoncée : ${t.gainHorsAnnonce} ; ère inconnue : ${t.gainEreInconnue}.`);
    L.push(`Du gain, **déjà visé par une autre source en cours** (TABLE_TPC : TPC Asie, pokemon-card.com) : ${t.gainAutreSource}.`, '');
    L.push('## Par ère', '', '| ère | annoncée | sets | gain | sans fiche |', '|---|---|---|---|---|');
    for (const e of R.eres) L.push(`| ${e.ere} | ${e.couvert === true ? 'oui' : e.couvert === false ? 'non' : '?'} | ${e.sets} | ${e.gain} | ${e.sansFiche} |`);
    L.push('', '## Par set (gain décroissant)', '', '| # | slug | nom | code | ère | annoncée | gain | sans fiche | autre source en cours |', '|---|---|---|---|---|---|---|---|---|');
    R.sets.forEach((s, i) => L.push(`| ${i + 1} | ${s.slug} | ${s.nom} | ${s.code || '—'} | ${s.ere}${s.sousEre ? ` / ${s.sousEre}` : ''} | ${s.couvert === true ? 'oui' : s.couvert === false ? 'non' : '?'} | ${s.gain} | ${s.sansFiche} | ${s.autresSources.join(', ') || '—'} |`));
    L.push('', 'Ère lue sur le code de la table du dépôt, jamais sur le nom ; « ? » = ère non prouvée. Annoncée = figure dans la liste de couverture de Collectorviper du brief (supposition non vérifiée par requête).');
    return L.join('\n') + '\n';
}

module.exports = { ereDe, calculer, autresSourcesDe, rendreMd, CAUSES_GAIN, ERES_ANNONCEES, CAUSE_SANS_FICHE };

if (require.main === module) {
    const arg = n => process.argv.slice(2).find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const entree = arg('entree'), sortie = arg('sortie');
    if (!entree || !sortie) { console.error('permis : --entree=<tous.json> --sortie=<dossier>'); process.exit(2); }
    const T = require('./table-sets.js');
    const codes = new Map();
    for (const l of [...T.TABLE, ...T.TABLE_AUTO, ...T.TABLE_SANS_PAGE]) if (l.slugSet && l.code && !codes.has(l.slugSet)) codes.set(l.slugSet, l.code);
    const R = calculer(JSON.parse(fs.readFileSync(entree, 'utf8')), codes, autresSourcesDe(require('./tpc-sets').TABLE_TPC));
    fs.mkdirSync(sortie, { recursive: true });
    fs.writeFileSync(path.join(sortie, 'gain-collectorviper.json'), JSON.stringify(R, null, 1));
    fs.writeFileSync(path.join(sortie, 'gain-collectorviper.md'), rendreMd(R));
    const d = R.denominateur, t = R.totaux;
    console.log(`non servis jp ${d.jpNonServis}/${d.jpTotal} ; gain ${t.gain} (couvert ${t.gainCouvert}, non annoncé ${t.gainHorsAnnonce}, inconnu ${t.gainEreInconnue}) ; déjà visé par une autre source ${t.gainAutreSource} ; sans fiche ${t.sansFiche} ; hors gain ${t.horsGain} ; sans cause ${t.sansCause}`);
}
