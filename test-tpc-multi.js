// node test-tpc-multi.js — LIGNES À PLUSIEURS LISTES SOURCE (lot TPC-AS, 2026-10-11) : TPC Asie sert les sets idth AS1-AS4 par DEMI-LISTES
// (xxa, xxb) ; notre préfixe de numéro (a019, b016) EST la demi-liste, au même numéro. Pur : aucun réseau, aucune base.
//   --figer  réécrit le plan de référence d'une ligne EXISTANTE (à ne lancer que sur le code d'AVANT ce lot : il prouve que le
//            comportement d'une ligne à une liste n'a pas bougé d'un octet).
const fs = require('fs');
const path = require('path');
const T = require('./collecte-cartes/tpc');
const S = require('./collecte-cartes/tpc-sets');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const GOLDEN = path.join(__dirname, 'collecte-cartes', 'tpc-fixtures', 'plan-ligne-simple.golden.json');

// ── le plan d'une ligne EXISTANTE (mêmes entrées que test-tpc.js, section 3) ─────────────────────────────────────────
const fiche = (n, nom, extra = {}) => ({ idFiche: 1000 + Number(n), nom, numero: n, denominateur: 'SV-P', image: `https://asia.pokemon-card.com/id/card-img/id${n}.png`, ...extra });
const trous = [
    { carte: { _id: 10, nomEn: 'Super Rod', categorie: 'dresseur' }, numeroFiche: '035', idProduct: 1 },
    { carte: { _id: 10, nomEn: 'Super Rod', categorie: 'dresseur' }, numeroFiche: '169', idProduct: 2 },
    { carte: { _id: 11, nomEn: 'Pikachu', categorie: 'pokemon', ndex: 25, pv: 60 }, numeroFiche: '050', idProduct: 3 },
    { carte: { _id: 12, nomEn: 'Eevee', categorie: 'pokemon' }, numeroFiche: '060', idProduct: 4 },
    { carte: { _id: 13, nomEn: 'Mew', categorie: 'pokemon' }, numeroFiche: null, idProduct: 5 },
    { carte: { _id: 14, nomEn: 'Snorlax', categorie: 'pokemon' }, numeroFiche: '070', idProduct: 6 },
    { carte: { _id: 14, nomEn: 'Snorlax', categorie: 'pokemon' }, numeroFiche: '070', idProduct: 7 },
    { carte: { _id: 20, nomEn: 'Zorua' }, numeroFiche: '099', idProduct: 9 }
];
const fiches = [fiche('035', 'Super Rod'), fiche('169', 'Super Rod'), fiche('050', 'Pikachu', { dex: 25, pv: 60 }), fiche('060', 'Eevee'), fiche('060', 'Eevee'), fiche('070', 'Snorlax')];
const fm = (n, nom, den, sym) => ({ idFiche: 2000 + Number(n), nom, numero: n, denominateur: den, symbole: sym, image: `https://asia.pokemon-card.com/id/card-img/x${n}.png` });
const S1 = 'https://asia.pokemon-card.com/id/card-img/mark/MA5.png', S2 = 'https://asia.pokemon-card.com/id/card-img/mark/SV1.png';
const fichesM = [fm('165', 'Chespin', '164', S1), fm('166', 'Fomantis', '164', S1), fm('167', 'Fennekin', '164', S1), fm('168', 'Armarouge', '198', S1), fm('169', 'Goldeen', '164', S2)];
const tm = n => ({ carte: { _id: Number(n), nomEn: fichesM.find(f => f.numero === n).nom }, numeroFiche: n, idProduct: Number(n) });
const rejouerLigneSimple = () => ({
    sv: T.planifierTpc({ trous, fiches, code: 'SV-P', site: 'tpc-asie' }),
    ma5: T.planifierTpc({ trous: ['165', '166', '167', '168', '169'].map(tm), fiches: fichesM, code: 'MA5', site: 'tpc-asie' })
});

if (process.argv.includes('--figer')) {
    fs.writeFileSync(GOLDEN, JSON.stringify(rejouerLigneSimple(), null, 1));
    console.log('plan de référence écrit :', GOLDEN);
    process.exit(0);
}

(async () => {
    // ── 1. UNE LIGNE EXISTANTE NE BOUGE PAS ───────────────────────────────────────────────────────────────────────────
    verifier('le plan d\'une ligne à une liste est identique, octet pour octet, à celui d\'avant le lot', JSON.stringify(rejouerLigneSimple()), JSON.stringify(JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))));
    const sans = S.TABLE_TPC.filter(l => !l.listes);
    verifier('les 70 lignes d\'avant sont toujours là, aucune ne porte `listes`', [S.TABLE_TPC.filter(l => !['First-Impact', 'Legends-Awakened-ID-TH', 'Hidden-Shadow', 'Sky-Ruler'].includes(l.slug)).length, sans.length >= 70 ? 'ok' : sans.length], [70, 'ok']);
    verifier('listesDe(ligne existante) = UNE liste, sans préfixe, au code et au compte de la ligne',
        S.TABLE_TPC.filter(l => !l.listes).every(l => { const x = S.listesDe(l); return x.length === 1 && x[0].prefixe === null && x[0].code === l.code && x[0].cartes === l.cartes; }), true);

    // ── 2. LE PLAN D'UNE LIGNE À DEMI-LISTES ─────────────────────────────────────────────────────────────────────────
    // a019 « Celebi Bersinar » (nom indonésien traduit, Pokédex 251) ; b016 « EspeonGX » ; les mêmes numéros existent dans l'AUTRE liste
    const f = (prefixe, n, nom, extra = {}) => ({ idFiche: (prefixe === 'a' ? 3000 : 4000) + Number(n), nom, numero: n, denominateur: '150', symbole: 'https://x/AS1.png', prefixe, listeCode: `AS1${prefixe}`, image: `https://asia.pokemon-card.com/id/card-img/${prefixe}${n}.png`, ...extra });
    const fa = [f('a', '019', 'Celebi Bersinar', { dex: 251, pv: 70, categorie: 'pokemon' }), f('a', '016', 'Pikachu', { dex: 25, pv: 60, categorie: 'pokemon' })];
    const fb = [f('b', '016', 'EspeonGX', { dex: 196, pv: 200, categorie: 'pokemon' }), f('b', '019', 'Dresseur traduit')];
    const celebi = { _id: 1, nomEn: 'Shining Celebi', categorie: 'pokemon', ndex: 251, pv: 70 };
    const espeon = { _id: 2, nomEn: 'Espeon GX', categorie: 'pokemon', ndex: 196, pv: 200 };
    const plan = (t, fs_ = [...fa, ...fb]) => T.planifierTpc({ trous: t, fiches: fs_, code: 'AS1', site: 'tpc-asie', prefixes: ['a', 'b'] });
    let P = plan([{ carte: celebi, numeroFiche: 'a019', idProduct: 1 }]);
    verifier('a019 : cherché dans la liste a SEULEMENT (la b019 a un autre nom) → prouvé par le Pokédex', [P.plan.length, P.plan[0]?.fiche.idFiche, P.plan[0]?.voie], [1, 3019, 'pokedex+pv']);
    P = plan([{ carte: espeon, numeroFiche: 'b016', idProduct: 2 }]);
    verifier('b016 : cherché dans la liste b SEULEMENT (la a016 est un Pikachu) → prouvé', [P.plan.length, P.plan[0]?.fiche.idFiche], [1, 4016]);
    verifier('   la preuve nomme le numéro avec son préfixe et le set', /b016/.test(P.plan[0]?.preuve || '') && /AS1b/.test(P.plan[0]?.preuve || ''), true);
    P = plan([{ carte: espeon, numeroFiche: 'b016', idProduct: 2 }], [...fa]);
    verifier('b016 absent de la liste b, présent en a016 → trou « absente-de-la-source », jamais la fiche de l\'autre liste', [P.plan.length, P.restes[0]?.motif], [0, 'absente-de-la-source']);
    P = plan([{ carte: celebi, numeroFiche: '019', idProduct: 3 }]);
    verifier('un produit SANS préfixe sur une ligne multi-listes → trou « prefixe-absent »', [P.plan.length, P.restes[0]?.motif], [0, 'prefixe-absent']);
    P = plan([{ carte: celebi, numeroFiche: 'c019', idProduct: 4 }]);
    verifier('un préfixe qui n\'est pas une liste de la ligne → trou « prefixe-inconnu »', [P.plan.length, P.restes[0]?.motif], [0, 'prefixe-inconnu']);
    P = plan([{ carte: celebi, numeroFiche: null, idProduct: 5 }]);
    verifier('un produit sans numéro → trou « sans-numero » (inchangé)', P.restes[0]?.motif, 'sans-numero');
    // le set se juge PAR LISTE : une fiche à un autre dénominateur que la majorité DE SA LISTE est un trou
    const fa2 = [f('a', '019', 'Celebi Bersinar', { dex: 251, pv: 70, categorie: 'pokemon' }), f('a', '020', 'Pikachu', { denominateur: '170' }), f('a', '021', 'Pikachu'), f('a', '022', 'Pikachu')];
    const fb2 = [f('b', '016', 'EspeonGX', { dex: 196, pv: 200, categorie: 'pokemon', denominateur: '170' }), f('b', '017', 'Pikachu', { denominateur: '170' })];
    P = plan([{ carte: celebi, numeroFiche: 'a019', idProduct: 1 }, { carte: { _id: 7, nomEn: 'Pikachu' }, numeroFiche: 'a020', idProduct: 7 }, { carte: espeon, numeroFiche: 'b016', idProduct: 2 }], [...fa2, ...fb2]);
    verifier('dénominateur : la majorité de la liste a (150) ne juge pas la liste b (170)', [P.plan.map(x => x.numero), P.restes.map(r => `${r.numero}:${r.motif}`)], [['a019', 'b016'], ['a020:set']]);
    verifier('le décompte : plan + restes = (carte, numéro) distincts', plan([{ carte: celebi, numeroFiche: 'a019', idProduct: 1 }, { carte: celebi, numeroFiche: '019', idProduct: 8 }, { carte: espeon, numeroFiche: 'b016', idProduct: 2 }]).plan.length, 2);

    // ── 3. LA LIGNE : écrite par ce qu'elle autorise ──────────────────────────────────────────────────────────────────
    for (const [slug, code, ta, tb] of [['First-Impact', 'AS1', 150, 150], ['Legends-Awakened-ID-TH', 'AS2', 170, 171], ['Hidden-Shadow', 'AS3', 183, 183], ['Sky-Ruler', 'AS4', 178, 178]]) {
        const L = S.ligneTpc('tpc-asie', slug);
        const x = L ? S.listesDe(L) : [];
        verifier(`${slug} : site tpc-asie id, code ${code}, tirage idth, listes a/b aux totaux mesurés`, [L?.langue, L?.code, L?.tirage, x.map(l => `${l.prefixe}:${l.code}:${l.cartes}`)], ['id', code, 'idth', [`a:${code}a:${ta}`, `b:${code}b:${tb}`]]);
        verifier(`   ${slug} : l'unité de file porte le code de la ligne`, L && S.uniteDeLaLigne(L).code, code);
    }
    verifier('Tag-Team-Collection (AC3, non calibré) : PAS de ligne', S.ligneTpc('tpc-asie', 'Tag-Team-Collection'), null);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
