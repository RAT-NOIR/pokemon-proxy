// TEST — une page d'HOMONYMIE n'est jamais écrite comme carte ni inscrite dans `cartes.sets` (R4, 2026-10-12).
// La cause (collecteur-texte.js, boucle « 3. le texte ») : chaque page rendue par Bulbapedia pour un titre de Setlist était
// upsertée avec `$addToSet: { sets: slug }`, sans regarder ce qu'elle était. Les 6 pages `{{disambig}}` / `{{tcgdisambig}}` de la
// base y sont entrées par là (12 appartenances, 9 sets). Pur : fausse base, faux R2 ; les wikitexts sont de VRAIES pages archivées.
const fs = require('fs');
const path = require('path');
const P = require('./collecte-cartes/page-de-carte');
const W = require('./collecte-cartes/wikitext');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) ok++; else { ko++; console.log(`  ✗ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const fx = nom => fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'r47-fixtures', `${nom}.wikitext`), 'utf8');

// 1. la détection, sur les deux formes réelles et sur une vraie carte
verifier('{{disambig}} (Darkness Energy (TCG))', P.estPageDHomonymie(fx('homonymie-energie')), true);
verifier('{{tcgdisambig}} (Pikachu SV-P Promo 1)', P.estPageDHomonymie(fx('homonymie-tcg')), true);
verifier('casse et espaces : {{ TCGDisambig }}', P.estPageDHomonymie('{{TCG\n|Eevee\n}}\n{{ TCGDisambig \n}}'), true);
verifier('vraie carte (Oddish) : pas une homonymie', P.estPageDHomonymie(fx('oddish-svp-102')), false);
verifier('vraie carte (Mega Malamar) : pas une homonymie', P.estPageDHomonymie(fx('mega-malamar-ex-delta-reign-69')), false);
verifier('gabarit commenté : pas une homonymie', P.estPageDHomonymie('{{PokémoncardInfobox\n|cardname=X\n}}\n<!--{{disambig}}-->'), false);
verifier('texte vide / absent', [P.estPageDHomonymie(''), P.estPageDHomonymie(null)], [false, false]);

// 2. la décision : écrite par ce qu'elle AUTORISE (un nom, pas une homonymie)
verifier('décision : Oddish autorisée', P.decisionDePage(fx('oddish-svp-102'), 'Oddish (SVP Promo 102)'), { carte: true });
verifier('décision : homonymie refusée', P.decisionDePage(fx('homonymie-tcg'), 'Pikachu (SV-P Promo 1)'), { carte: false, motif: 'homonymie' });
verifier('décision : page sans nom refusée', P.decisionDePage('{{Project TCG notice\n}}', 'Truc'), { carte: false, motif: 'sans-nom' });

// 3. le CHEMIN DE PRODUCTION : la fonction que collecteur-texte.js appelle, sur une fausse base
function faux() {
    const appels = [];
    const rec = (coll, op) => async (...a) => { appels.push([coll, op, ...a]); return {}; };
    const M = {
        Carte: { updateOne: rec('Carte', 'updateOne'), findById: () => ({ select: () => ({ lean: async () => null }) }) },
        Etat: { updateOne: rec('Etat', 'updateOne') },
        Reste: { updateOne: rec('Reste', 'updateOne') }
    };
    const depots = [];
    const R2 = { cleWikitext: (p, r) => `bulba/${p}/${r}.wikitext`, deposerTexte: async (b, cle) => { depots.push(cle); return { ecrit: true }; } };
    return { M, R2, appels, depots };
}
const contexte = (f, pg) => ({
    M: f.M, r2: f.R2, bucket: 'B', pg, slug: 'Set-Test', lot: [pg.title], redirigeDepuisTout: new Map(),
    D: { epure: {} }, textesEpures: new Map(), compter: () => {}, impressionCible: () => null, compteRequetes: () => 7
});
(async () => {
    for (const [nom, titre, motif] of [['homonymie-energie', 'Darkness Energy (TCG)', 'homonymie'], ['homonymie-tcg', 'Pikachu (SV-P Promo 1)', 'homonymie']]) {
        const f = faux();
        const r = await P.ecrirePageDeCarte(contexte(f, { title: titre, pageid: 111, revid: 222, content: fx(nom) }));
        verifier(`${titre} : rendue non écrite`, [r.ecrite, r.motif], [false, motif]);
        verifier(`${titre} : AUCUNE écriture sur cartes`, f.appels.filter(a => a[0] === 'Carte'), []);
        verifier(`${titre} : aucun $addToSet sets nulle part`, JSON.stringify(f.appels).includes('"sets"'), false);
        verifier(`${titre} : aucun dépôt R2`, f.depots, []);
        const etat = f.appels.filter(a => a[0] === 'Etat');
        verifier(`${titre} : l'état retient le titre (pas de refetch), étiqueté homonymie`, etat.length === 1 && etat[0][3].$push.pages.$each.map(p => [p.titre, p.etat]), [[titre, 'homonymie']]);
        verifier(`${titre} : un reste nomme la page`, f.appels.filter(a => a[0] === 'Reste').map(a => [a[2].set, a[2].type, a[2].detail]), [['Set-Test', 'page-sans-carte', titre]]);
    }
    // une vraie carte passe, avec son appartenance : le garde ne ferme pas tout
    const f = faux();
    const r = await P.ecrirePageDeCarte(contexte(f, { title: 'Oddish (SVP Promo 102)', pageid: 295618, revid: 9, content: fx('oddish-svp-102') }));
    verifier('Oddish : écrite', r.ecrite, true);
    const up = f.appels.filter(a => a[0] === 'Carte' && a[1] === 'updateOne');
    verifier('Oddish : un upsert avec $addToSet sets', up.length === 1 && up[0][3].$addToSet.sets === 'Set-Test' && up[0][4].upsert === true, true);
    verifier('Oddish : numéro propre écrit (102), aucun jp', up[0][3].$set.impressions.map(i => [i.tirage, i.numero]), [['intl', '102']]);
    verifier('Oddish : déposée sur R2', f.depots.length, 1);

    // 4. la source : collecteur-texte.js passe par cette fonction et ne garde pas l'upsert en direct
    const src = fs.readFileSync(path.join(__dirname, 'collecteur-texte.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    verifier('collecteur-texte.js appelle ecrirePageDeCarte', /ecrirePageDeCarte\(/.test(src), true);
    verifier('collecteur-texte.js n\'upserte plus `$addToSet: { sets: slug }` lui-même', /\$addToSet:\s*\{\s*sets:\s*slug\s*\}/.test(src), false);
    // 5. une homonymie dans les VRAIES données de ce lot n'est pas lue comme carte par le parseur non plus : nomEn nul
    verifier('parseur : une homonymie n\'a pas de nom', W.faitsDeCarte(fx('homonymie-tcg'), 'Pikachu (SV-P Promo 1)').nomEn, null);

    console.log(`${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
