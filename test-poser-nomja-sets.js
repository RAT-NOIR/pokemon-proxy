// Banc PUR (aucune base, aucun réseau) de poser-nomja-sets.js : le nomJa d'un set se prouve par DEUX sources ouvertes, liées par le CODE.
//   node test-poser-nomja-sets.js
const P = require('./poser-nomja-sets');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const WT = {
    dark: '{{TCGPromoInfobox\n|setname=Enhanced Expansion Pack: Dark Phantasma<br><small><small>強化拡張パック ダークファンタズマ</small></small>\n|logo=S10a Dark Phantasma Logo.png\n|cards=99\n}}',
    vmax: '{{TCGPromoInfobox\n|setname=VMAX Rising<br><small>強化拡張パック VMAXライジング</small>\n|logo=S1a Logo.png\n}}',
    champ: '{{TCGPromoInfobox\n|setname=Champion Road<br><small><small>強化拡張パック<br>チャンピオンロード</small></small>\n|logo=SM6b Logo.png\n}}',
    ultra: '{{TCGPromoInfobox\n|setname=Ultra Force<br><small><small>強化拡張パック<br>ウルトラフォース</small></small>\n|logo=SM5Plus Logo.png\n}}',
    sansJa: '{{TCGPromoInfobox\n|setname=Some Set\n|logo=S10a Logo.png\n}}'
};
const LISTE = [{ id: 'S10a', name: 'ダークファンタズマ' }, { id: 'S11a', name: '白熱のアルカナ' }, { id: 'S1a', name: 'VMAXライジング' }, { id: 'SM6b', name: 'チャンピオンロード' },
    { id: 'SM5+', name: 'ウルトラフォース' }, { id: 'SM5p', name: 'ウルトラフォース' }, { id: 'SM11b', name: 'ドリームリーグ' }];

(async () => {
    // 1. Bulbapedia : le nom japonais de l'infobox, sans le nom de la gamme
    verifier('bulba : Dark Phantasma (une ligne)', P.nomJaDeBulbapedia(WT.dark).nomJa, 'ダークファンタズマ');
    verifier('bulba : VMAX Rising (gamme + nom collés par une espace)', P.nomJaDeBulbapedia(WT.vmax).nomJa, 'VMAXライジング');
    verifier('bulba : Champion Road (gamme <br> nom)', P.nomJaDeBulbapedia(WT.champ).nomJa, 'チャンピオンロード');
    verifier('bulba : le fichier du logo est lu', P.nomJaDeBulbapedia(WT.ultra).logo, 'SM5Plus Logo.png');
    verifier('bulba : un commentaire HTML collé au fichier du logo est retiré', P.nomJaDeBulbapedia(WT.ultra.replace('SM5Plus Logo.png', 'SM5Plus Logo.png-->')).logo, 'SM5Plus Logo.png');
    verifier('bulba : pas de japonais → aucune valeur, une raison', [P.nomJaDeBulbapedia(WT.sansJa).nomJa, typeof P.nomJaDeBulbapedia(WT.sansJa).raison], [undefined, 'string']);
    verifier('bulba : pas de setname → raison', typeof P.nomJaDeBulbapedia('rien').raison, 'string');
    verifier('bulba : deux noms japonais différents → ambigu, refus', typeof P.nomJaDeBulbapedia('|setname=A<br><small>強化拡張パック アイウ</small><br><small>エオカ</small>\n|logo=X.png').raison, 'string');

    // 2. TCGdex : l'identifiant (le code), jamais le nom
    verifier('tcgdex : s10a → S10a', P.nomJaDeTcgdex(LISTE, 's10a'), { id: 'S10a', nomJa: 'ダークファンタズマ' });
    verifier('tcgdex : sm5+ → SM5+ (et pas SM5p, qui porte le même nom)', P.nomJaDeTcgdex(LISTE, 'sm5+').id, 'SM5+');
    verifier('tcgdex : code absent de la liste → raison', typeof P.nomJaDeTcgdex(LISTE, 'zz9').raison, 'string');
    verifier('tcgdex : deux sets au même identifiant (casse près) → raison', typeof P.nomJaDeTcgdex([...LISTE, { id: 's10A', name: 'x' }], 's10a').raison, 'string');
    verifier('tcgdex : liste vide → raison, pas un vide pris pour une absence', typeof P.nomJaDeTcgdex([], 's10a').raison, 'string');

    // 3. la preuve : deux sources d'accord, liées par le code, et égales à ce que le coordinateur a lu sur le logo
    const set = (id, code, extra = {}) => ({ _id: id, code, nomJa: null, tirage: 'jp', ...extra });
    const p1 = P.prouver(set('Dark-Phantasma', 's10a'), LISTE, WT.dark);
    verifier('Dark-Phantasma : prouvé', [p1.ok, p1.nomJa], [true, 'ダークファンタズマ']);
    verifier('Ultra-Force (code sm5+, logo SM5Plus) : prouvé', P.prouver(set('Ultra-Force', 'sm5+'), LISTE, WT.ultra).ok, true);
    verifier('Champion-Road : prouvé', P.prouver(set('Champion-Road', 'sm6b'), LISTE, WT.champ).ok, true);
    verifier('VMAX-Rising : prouvé (s1a ne prend pas S10a)', P.prouver(set('VMAX-Rising', 's1a'), LISTE, WT.vmax).ok, true);
    verifier('les deux sources divergent → refus', P.prouver(set('Dark-Phantasma', 's10a'), LISTE.map(x => x.id === 'S10a' ? { ...x, name: 'ダークファンタズマ2' } : x), WT.dark).ok, false);
    verifier('le logo de la page ne commence pas par le code du set → refus (lien non tenu)', P.prouver(set('Dark-Phantasma', 's10a'), LISTE, WT.dark.replace('S10a Dark', 'S11a Dark')).ok, false);
    verifier('le code « s1a » ne se lit pas dans « S10a… » (frontière de mot)', P.prouver(set('VMAX-Rising', 's1a'), LISTE, WT.vmax.replace('S1a Logo', 'S10a Logo')).ok, false);
    verifier('un set hors de la liste fermée → refus', P.prouver(set('Black-Bolt-JP', 'sv11B'), LISTE, WT.dark).ok, false);
    verifier('les deux sources d\'accord mais différentes de ce qui a été lu sur le logo → refus', P.prouver(set('Dark-Phantasma', 's10a'), LISTE.map(x => x.id === 'S10a' ? { ...x, name: 'ダークファンタズマ2' } : x), WT.dark.replace('ダークファンタズマ', 'ダークファンタズマ2')).ok, false);
    verifier('la liste fermée : 6 sets', Object.keys(P.SETS_NOMJA).sort(), ['Champion-Road', 'Dark-Phantasma', 'Dream-League', 'Incandescent-Arcana', 'Ultra-Force', 'VMAX-Rising']);

    // 4. l'écriture : un seul champ, absent → valeur ; jamais de remplacement
    const fausseColl = (doc, { modifiedCount = 1 } = {}) => { const appels = []; return { appels, findOne: async () => doc, updateOne: async (f, u) => { appels.push({ f, u }); return { modifiedCount }; } }; };
    const pr = { ok: true, nomJa: 'ダークファンタズマ' };
    let S = fausseColl({ _id: 'Dark-Phantasma', nomJa: null });
    verifier('doc.nomJa null → écrit', (await P.ecrireNomJa(S, 'Dark-Phantasma', pr)).action, 'ecrit');
    verifier('… avec un filtre qui exige nomJa vide et un $set du seul nomJa', [JSON.stringify(S.appels[0].f), JSON.stringify(S.appels[0].u)], [JSON.stringify({ _id: 'Dark-Phantasma', nomJa: null }), JSON.stringify({ $set: { nomJa: 'ダークファンタズマ' } })]);
    S = fausseColl({ _id: 'Dark-Phantasma' });
    verifier('doc sans champ nomJa → écrit', (await P.ecrireNomJa(S, 'Dark-Phantasma', pr)).action, 'ecrit');
    S = fausseColl({ _id: 'Dark-Phantasma', nomJa: 'ダークファンタズマ' });
    verifier('déjà la même valeur → deja, aucune écriture', [(await P.ecrireNomJa(S, 'Dark-Phantasma', pr)).action, S.appels.length], ['deja', 0]);
    S = fausseColl({ _id: 'Dark-Phantasma', nomJa: 'autre' });
    verifier('une valeur différente → refus, aucune écriture', [(await P.ecrireNomJa(S, 'Dark-Phantasma', pr)).action, S.appels.length], ['refus', 0]);
    S = fausseColl(null);
    verifier('set absent → refus', (await P.ecrireNomJa(S, 'Dark-Phantasma', pr)).action, 'refus');
    S = fausseColl({ _id: 'Dark-Phantasma', nomJa: null }, { modifiedCount: 0 });
    verifier('le champ est apparu entre-temps (0 modifié) → refus', (await P.ecrireNomJa(S, 'Dark-Phantasma', pr)).action, 'refus');
    S = fausseColl({ _id: 'Dark-Phantasma', nomJa: null });
    verifier('une preuve non ok n\'écrit rien', [(await P.ecrireNomJa(S, 'Dark-Phantasma', { ok: false })).action, S.appels.length], ['refus', 0]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
