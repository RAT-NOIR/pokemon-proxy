'use strict';
// COPIE-SITE-2 — la règle « une impression appartient au set » (lot 2-A du site : le DECK), appliquée par le chargeur. Pas de base, pas de réseau : données SYNTHÉTIQUES.
//   · la copie embarquée rend les mêmes résultats que le module du site (lu au commit NOMMÉ, écrit dans un temporaire) sur des vecteurs fabriqués ;
//   · trois sets qui partagent UNE expansion se distinguent par leur deck : chacun ne garde que ses impressions ;
//   · decider() (le chargeur) et la mesure (mesurer-collection.js) appellent la règle ; la projection de source.js porte `deck`.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { pathToFileURL } = require('url');
const H = require('./_harnais');
const C = require('../chargeur/copier-regle-site');

(async () => {
    const R = await require('../chargeur/regle-site').regleEmbarquee();
    const M = await import(pathToFileURL(path.join(C.DOSSIER, 'impressionDuSet.mjs')).href);
    H.v('la règle embarquée porte impressionDuSet', typeof R.impressionDuSet, 'function');

    // --- les vecteurs : la copie contre le module du site AU COMMIT NOMMÉ (jamais l'arbre de travail) ---
    const impr = (deck, o = {}) => ({ tirage: 'intl', expansion: 'Classic', deck, ...o });
    const IMPS = [impr('Venusaur'), impr('Charizard'), impr('Blastoise'), impr(undefined), impr(null), impr('  VENUSAUR '), impr('Ｖｅｎｕｓａｕｒ'), impr('Venusaur', { tirage: 'jp' }), impr('Venusaur', { expansion: 'Autre' }), impr('')];
    const CIBLES = [
        { nom: 'Venusaur', cible: { tirage: 'intl', expansions: ['Classic'], deck: 'Venusaur' }, attendu: [true, false, false, false, false, true, true, false, false, false] },
        { nom: 'Charizard', cible: { tirage: 'intl', expansions: ['Classic'], deck: 'Charizard' }, attendu: [false, true, false, false, false, false, false, false, false, false] },
        { nom: 'Blastoise', cible: { tirage: 'intl', expansions: ['Classic'], deck: 'Blastoise' }, attendu: [false, false, true, false, false, false, false, false, false, false] },
        { nom: 'sans deck (absent)', cible: { tirage: 'intl', expansions: ['Classic'] }, attendu: [true, true, true, true, true, true, true, false, false, true] },
        { nom: 'deck null', cible: { tirage: 'intl', expansions: ['Classic'], deck: null }, attendu: [true, true, true, true, true, true, true, false, false, true] },
        { nom: 'deck fait d\'espaces = pas de deck', cible: { tirage: 'intl', expansions: ['Classic'], deck: '   ' }, attendu: [true, true, true, true, true, true, true, false, false, true] },
        { nom: 'deck vide = pas de deck', cible: { tirage: 'intl', expansions: ['Classic'], deck: '' }, attendu: [true, true, true, true, true, true, true, false, false, true] }
    ];
    for (const { nom, cible, attendu } of CIBLES) H.v(`copie : set « ${nom} » : ses impressions seulement`, IMPS.map(i => R.impressionDuSet(i, cible)), attendu);

    const pin = C.lecteurGit(C.REPO_SITE, C.COMMIT), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-site-'));
    try {
        const sitePur = path.join(tmp, 'impressionDuSet.ts');
        fs.writeFileSync(sitePur, pin('impressionDuSet.ts'));
        const S = await import(pathToFileURL(sitePur).href);
        for (const { nom, cible } of CIBLES) H.v(`   identique au module du site : set « ${nom} »`, IMPS.map(i => M.impressionDuSet(i, cible)), IMPS.map(i => S.impressionDuSet(i, cible)));
        const textes = ['Venusaur', '  VENUSAUR ', 'Ｖｅｎｕｓａｕｒ', 'venusaur\n\tx', 'ﬁre', 'fire', 'É', 'é', '', '   ', null, undefined, 12];
        H.v('   nd : identique au site sur NFKC, casse et espaces', textes.map(M.nd), textes.map(S.nd));
        H.v('   nd : ce que NFKC, la casse et les espaces rendent égaux est égal (et rien de plus)', [M.nd('Ｖｅｎｕｓａｕｒ') === M.nd('venusaur'), M.nd(' A  b ') === M.nd('a b'), M.nd('é') === M.nd('é'), M.nd('venusaur') === M.nd('venusaurs')], [true, true, true, false]);
        H.v('   deckDuSet : vide ou espaces → null ; sinon la valeur brute (identique au site)', ['Venusaur', '', '   ', null, undefined, 3].map(M.deckDuSet), ['Venusaur', '', '   ', null, undefined, 3].map(S.deckDuSet));
        H.v('   deckDuSet : valeurs attendues', ['Venusaur', '', '   ', null, undefined].map(M.deckDuSet), ['Venusaur', null, null, null, null]);
        const brutes = ['Venusaur', '  VENUSAUR ', 'Charizard', 'Ｖｅｎｕｓａｕｒ', null, undefined, 7];
        H.v('   decksAcceptes : identique au site', [M.decksAcceptes('venusaur', brutes), M.decksAcceptes('  ', brutes), M.decksAcceptes('Inconnu', brutes)], [S.decksAcceptes('venusaur', brutes), S.decksAcceptes('  ', brutes), S.decksAcceptes('Inconnu', brutes)]);
        H.v('   conditionImpressionMongo : identique au site (avec et sans deck)', [M.conditionImpressionMongo('$$i', 'intl', ['Classic'], ['Venusaur']), M.conditionImpressionMongo('$$i', 'intl', ['Classic'], null)], [S.conditionImpressionMongo('$$i', 'intl', ['Classic'], ['Venusaur']), S.conditionImpressionMongo('$$i', 'intl', ['Classic'], null)]);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

    // --- decider() : trois sets, une même expansion Bulbapedia, trois decks ---
    const { decider } = require('../chargeur/decision');
    const sets = [['Set-V', 100, 'Venusaur'], ['Set-C', 200, 'Charizard'], ['Set-B', 300, 'Blastoise'], ['Set-N', 400, undefined]]
        .map(([id, idExpansion, deck]) => ({ _id: id, idExpansion, code: id.slice(-1), nomAffichage: id, tirage: 'intl', region: 'intl', bulba: { expansion: 'Classic' }, ...(deck ? { deck } : {}) }));
    const imp = (numero, deck) => ({ tirage: 'intl', expansion: 'Classic', numero, total: '60', rarete: 'Rare', ...(deck ? { deck } : {}) });
    const docs = [
        { _id: 1, nomEn: 'Carte 1', sets: ['Set-V'], impressions: [imp('001', 'Venusaur'), imp('002', 'Charizard')], images: [] },        // le fantôme : 002 vit dans un AUTRE deck
        { _id: 2, nomEn: 'Carte 2', sets: ['Set-C'], impressions: [imp('002', 'Charizard'), imp('003')], images: [] },                   // 003 : une impression SANS deck dans un set à deck
        { _id: 3, nomEn: 'Carte 3', sets: ['Set-B'], impressions: [imp('001', 'Blastoise')], images: [] },
        { _id: 4, nomEn: 'Carte 4', sets: ['Set-N'], impressions: [imp('001', 'Venusaur'), imp('002')], images: [] },                  // set SANS deck : rien ne change
        // même numéro dans deux decks, deux raretés : sans le filtre du deck, la rareté du set serait « contredite » (null) ; avec lui, c'est celle de SON deck
        { _id: 5, nomEn: 'Carte 5', sets: ['Set-V'], impressions: [imp('005', 'Venusaur'), { ...imp('005', 'Charizard'), rarete: 'Holo Rare' }],
            images: [{ set: 'Set-V', numero: '005', cleR2: 'cartes/c5.webp', w: 600, h: 838, vignette: { cleR2: 'vignettes/c5.webp', w: 200, h: 279 }, langue: 'en', source: 'tcgdex' }] }];
    const ligne = (id, carteId, idExpansion, numeroFiche, slugSet) => ({ idProduct: id, carteId, idExpansion, numeroFiche, slug: `P${id}-X${numeroFiche}`, slugSet });
    const lignes = [ligne(1, 1, 100, '001', 'Set-V'), ligne(2, 1, 100, '002', 'Set-V'), ligne(3, 2, 200, '002', 'Set-C'), ligne(4, 2, 200, '003', 'Set-C'),
        ligne(5, 3, 300, '001', 'Set-B'), ligne(6, 4, 400, '001', 'Set-N'), ligne(7, 4, 400, '002', 'Set-N'), ligne(8, 5, 100, '005', 'Set-V')];
    const metacarte = new Map(lignes.map(l => [l.idProduct, 9000 + l.idProduct]));
    const resultat = (s, regle = R) => decider({ sets: s, docs, lignes, metacarte, regle, cederLaMain: false });
    const sortie = async (s, regle = R) => (await resultat(s, regle)).liens;
    const cles = (liens, set) => [...(liens.get(set) || new Map()).keys()].sort();
    const RES = await resultat(sets), L = RES.liens;
    H.v('Set-V (deck Venusaur) : les fiches 1|001 et 5|005 — 002 est l\'impression du deck Charizard (pas de fiche fantôme)', cles(L, 'Set-V'), ['1|001', '5|005']);
    H.v('   la rareté d\'une impression qui partage son numéro avec un AUTRE deck est celle du deck du set (pas « contredite »)', [RES.entrees.find(e => e.idProduct === 8)?.rarete, RES.denominateurs.rareteContredite], ['Rare', 0]);
    H.v('Set-C (deck Charizard) : 2|002 seulement — 003 est une impression SANS deck : elle n\'appartient à aucun des trois', cles(L, 'Set-C'), ['2|002']);
    H.v('Set-B (deck Blastoise) : 3|001', cles(L, 'Set-B'), ['3|001']);
    H.v('Set-N (SANS deck) : inchangé — ses deux impressions, quel que soit leur deck', cles(L, 'Set-N'), ['4|001', '4|002']);
    H.v('   produits liés : Set-V [1] et [8] seulement (le produit 2 vise une fiche qui n\'existe pas dans ce deck)', [...(L.get('Set-V') || new Map()).values()], [[1], [8]]);

    // un deck fait d'espaces vaut l'absence de deck : le set garde TOUTES ses impressions
    const espaces = sets.map(s => (s._id === 'Set-V' ? { ...s, deck: '   ' } : s));
    H.v('deck fait d\'espaces : comme s\'il n\'y en avait pas (1|001, 1|002 et 5|005)', cles(await sortie(espaces), 'Set-V'), ['1|001', '1|002', '5|005']);
    H.v('deck du set écrit autrement (casse, plein-chasse, espaces) : même set', cles(await sortie(sets.map(s => (s._id === 'Set-V' ? { ...s, deck: ' ＶＥＮＵＳＡＵＲ ' } : s))), 'Set-V'), ['1|001', '5|005']);
    H.v('une règle sans impressionDuSet : decider LÈVE par sa vérification de règle, en la nommant (jamais un TypeError au milieu du calcul, jamais un repli)',
        await decider({ sets, docs, lignes, metacarte, regle: { ...R, impressionDuSet: undefined } }).then(() => null, e => /règle du site absente : impressionDuSet/.test(e.message)), true);
    H.v('REGLE_REQUISE (decision.js) exige impressionDuSet', require('../chargeur/decision').REGLE_REQUISE.includes('impressionDuSet'), true);
    // aucun filtre « les impressions de ce set » écrit à la main dans les deux endroits de v2/ qui le disaient : ils appellent la règle (et ne comparent plus tirage/expansion eux-mêmes)
    const MAIN = /\.tirage\s*[!=]==?\s|expansions\.includes|noms\.includes|\.expansion\s*[!=]==?/;
    for (const [nom, f] of [['decision.js', require.resolve('../chargeur/decision')], ['mesurer-collection.js', path.join(__dirname, 'mesure-chargeur', 'mesurer-collection.js')]]) {
        const src = fs.readFileSync(f, 'utf8');
        H.v(`${nom} : appelle regle.impressionDuSet et ne compare plus tirage/expansion à la main`, [/regle\.impressionDuSet\(/.test(src), MAIN.test(src)], [true, false]);
    }

    // --- la projection : `deck` sur les sets et sur les impressions ---
    const S = require('../chargeur/source'), I = S.interneur();
    H.v('compacterSet garde `deck`', S.compacterSet({ _id: 'Set-V', deck: 'Venusaur', bulba: { expansion: 'Classic' } }, I).deck, 'Venusaur');
    H.v('compacterCarte garde `impressions[].deck`', S.compacterCarte({ _id: 1, nomEn: 'x', impressions: [{ tirage: 'intl', expansion: 'Classic', deck: 'Venusaur' }], images: [] }, I).impressions[0].deck, 'Venusaur');
    H.v('PROJECTIONS : sets.deck et cartes[impressions.deck] demandés à la base', [S.PROJECTIONS.sets.deck, S.PROJECTIONS.cartes['impressions.deck']], [1, 1]);
    const vus = {};
    const ouvrir = async () => ({ ok: true, cartes: { fermer: async () => { }, collection: nom => ({ find: (f, o) => { vus[nom] = o.projection; return (async function* () { })(); } }) } });
    await S.sourceCartes({ ouvrir });
    H.v('sourceCartes : la projection ENVOYÉE à la base porte deck (sets) et impressions.deck (cartes)', [vus.sets?.deck, vus.cartes?.['impressions.deck']], [1, 1]);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
