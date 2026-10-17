// node test-provenance-bulba.js — la provenance des données d'origine Bulbapedia : EN BASE, seulement la marque « à reconfirmer » (forme minimale) ; les CONFIRMATIONS dans un fichier JSON
// daté avec son empreinte (décision du testeur, 2026-10-17 : « garde la valeur, marque-la à reconfirmer, et ne la sers pas comme seule preuve d'une identification » ; coordinateur,
// 2026-10-18 : la grappe `cartes` est à 212 Mo sur 512, la provenance ne grossit pas la base de ce qu'on peut garder dans un fichier).
// Fonctions pures, faux objets. `suite(module)` est rejouée contre des mutants (test-mutants-bulba.js).
const { setsTouches } = require('./collecte-cartes/garde-lot');

const trier = x => Array.isArray(x) ? x.map(trier) : (x && typeof x === 'object' && !(x instanceof Date)) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, trier(x[k])])) : x;

function suite(M) {
    let ok = 0, ko = 0;
    const verifier = (nom, obtenu, attendu) => {
        const a = JSON.stringify(trier(obtenu)), b = JSON.stringify(trier(attendu));
        if (a === b) { ok++; if (require.main === module) console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
    };
    const { planifierProvenance, appliquer, empreinteValeur: emp } = M;
    const T0 = new Date('2026-10-18T00:00:00Z'), T1 = new Date('2026-10-19T00:00:00Z');
    const copie = o => structuredClone(o);

    // une carte, deux impressions (une intl appariée, une japonaise sans source)
    const carte = (o = {}) => ({ _id: 1, nomEn: 'Seadra', nomJa: 'シードラ', pv: 60, retraite: 1, categorie: 'pokemon', ndex: 117, secret: 'inchange',
        impressions: [{ tirage: 'intl', expansion: 'Fossil', numero: '42', total: '62', rarete: 'Uncommon', illustrateur: 'K' }, { tirage: 'jp', expansion: 'Mystery of the Fossils', numero: null, total: null, rarete: 'Uncommon' }], ...o });
    const lg = (champ, cle, bulba, parSource, statut, contexte = {}) => ({ champ, cle, bulba, statut, parSource, contexte: { carteId: 1, nomEn: 'Seadra', categorie: 'pokemon', ...contexte } });
    const S = (statut, valeur = null) => ({ statut, valeur });
    const lignesDe = () => [
        lg('carte.pv', 1, 60, { pkc: S('ok', 60), tdx: S('ok', 60) }, 'accord'),
        lg('carte.retraite', 1, 1, {}, 'sans'),
        lg('carte.ndex', 1, 117, { tdx: S('ok', 117) }, 'accord'),
        lg('impression.total', '1#0', '62', { pkc: S('ok', 62) }, 'accord', { tirage: 'intl' }),
        lg('impression.rarete', '1#0', 'Uncommon', { pkc: S('ok', 'Uncommon'), tdx: S('ok', 'Uncommon') }, 'accord', { tirage: 'intl' }),
    ];
    const appar = [{ carteId: 1, idx: 0, tirage: 'intl', src: 'pkc', nomOk: true }, { carteId: 1, idx: 0, tirage: 'intl', src: 'tdx', nomOk: true }];
    const plan = (o = {}) => planifierProvenance({ cartes: [carte()], sets: [], lignes: lignesDe(), appariements: appar, arbitrages: [], maintenant: T0, ...o });
    const ecr = (p, collection = 'cartes') => p.ecritures.find(e => e.collection === collection);
    const conf = (p, champ, collection = 'cartes', k) => p.confirmations.find(c => c.collection === collection && c.champ === champ && (k === undefined || c.k === k));
    const reco = (v, motif = 'non-couvert') => ({ aReconfirmer: true, motif, v: emp(v) });

    // ── 1. EN BASE : SEULEMENT la marque « à reconfirmer », sous sa forme MINIMALE. Un champ confirmé n'est JAMAIS écrit en base.
    let p = plan(); let e = ecr(p).champs;
    verifier('retraite sans source : { aReconfirmer, motif, v } et rien d’autre', e['provenance.retraite'], reco(1, 'non-couvert'));
    verifier('pv confirmé par deux sources : AUCUNE écriture en base', ['provenance.pv' in e, 'provenance.ndex' in e, 'provenance.nomEn' in e], [false, false, false]);
    verifier('aucune confirmation dans les $set (ni confirmePar, ni accord, ni empreinteValeur)', /confirmePar|accord|empreinteValeur/.test(JSON.stringify(e)), false);
    verifier('source et date posées UNE fois, au niveau du document', [e['provenance.source'], e['provenance.le']], ['bulbapedia', T0]);
    verifier('nomJa sans appariement japonais : à reconfirmer, non couvert', e['provenance.nomJa'], reco('シードラ', 'non-couvert'));
    const imp = e['provenance.impressions'];
    verifier('impressions : seulement celles qui ont un champ à reconfirmer, jamais d’entrée { k } vide', [imp.length, imp[0].k, Object.keys(imp[0]).sort()], [1, 'jp|Mystery of the Fossils|', ['k', 'rarete']]);
    verifier('impression japonaise sans source : rareté à reconfirmer (forme minimale)', imp[0].rarete, reco('Uncommon', 'non-couvert'));

    // ── 2. LES CONFIRMATIONS vont au FICHIER, avec leur preuve (sources, accord, empreinte de la valeur certifiée)
    verifier('pv : confirmation dans le fichier, accord plein, deux sources', [conf(p, 'pv').confirmePar, conf(p, 'pv').accord, conf(p, 'pv').empreinteValeur], [['pkmncards', 'tcgdex'], 'plein', emp(60)]);
    verifier('nomEn : confirmé par les sources dont l’appariement (set, numéro) a un nom concordant', conf(p, 'nomEn').confirmePar, ['pkmncards', 'tcgdex']);
    verifier('impression intl : numéro, total et rareté confirmés, dans le fichier, par clé', ['numero', 'total', 'rarete'].map(c => conf(p, c, 'cartes', 'intl|Fossil|42').confirmePar), [['pkmncards', 'tcgdex'], ['pkmncards'], ['pkmncards', 'tcgdex']]);
    verifier('le fichier compte tout ce qui est confirmé (6) et rien de ce qui est à reconfirmer', [p.confirmations.length, p.confirmations.some(c => c.champ === 'retraite')], [6, false]);
    p = plan({ appariements: [{ carteId: 1, idx: 0, tirage: 'intl', src: 'pkc', nomOk: false }] });
    verifier('nom divergent à l’appariement : nomEn et numéro à reconfirmer, motif « desaccord »', [ecr(p).champs['provenance.nomEn'].motif, ecr(p).champs['provenance.impressions'].find(x => x.k === 'intl|Fossil|42').numero.motif], ['desaccord', 'desaccord']);
    p = plan({ appariements: [{ carteId: 1, idx: 1, tirage: 'jp', src: 'jp', nomOk: true }] });
    verifier('nomJa confirmé par pokemon-card.com : dans le fichier, pas en base', [conf(p, 'nomJa').confirmePar, 'provenance.nomJa' in ecr(p).champs], [['pokemon-card.com'], false]);

    // ── 3. DÉSACCORDS : l'arbitrage décide ; une valeur contestée n’est JAMAIS « confirmée » par défaut. Le décompte SÉPARE plein, partiel et arbitrage.
    const desacc = (verdict, extra = {}) => ({ champ: 'carte.pv', cle: 1, verdict, temoins: [], ...extra });
    const lDes = () => [lg('carte.pv', 1, 60, { pkc: S('ko', 50) }, 'desaccord')];
    p = plan({ lignes: lDes(), arbitrages: [desacc('indecidable')] });
    verifier('désaccord indécidable : à reconfirmer, motif « desaccord », forme minimale', ecr(p).champs['provenance.pv'], reco(60, 'desaccord'));
    p = plan({ lignes: lDes(), arbitrages: [desacc('fausse', { correction: 50 })] });
    verifier('désaccord arbitré « fausse » : à reconfirmer (la valeur reste, la correction attend son lot)', ecr(p).champs['provenance.pv'], reco(60, 'desaccord'));
    p = plan({ lignes: lDes(), arbitrages: [desacc('juste', { raison: 'convention de nom', temoins: [{ source: 'tdx', valeur: 'x' }, { source: 'convention-calibree', valeur: {} }] })] });
    verifier('désaccord arbitré « juste » : confirmé (fichier), accord « arbitrage », sources témoins seules ; rien en base', [conf(p, 'pv').confirmePar, conf(p, 'pv').accord, conf(p, 'pv').via, 'provenance.pv' in ecr(p).champs], [['tcgdex'], 'arbitrage', 'convention de nom', false]);
    p = plan({ lignes: lDes(), arbitrages: [] });
    verifier('désaccord SANS arbitrage : jamais confirmé (la garde s’écrit par ce qu’elle autorise)', ecr(p).champs['provenance.pv'].aReconfirmer, true);
    p = plan({ lignes: [lg('carte.pv', 1, 60, { pkc: S('approx', 60) }, 'approx')] });
    verifier('inclusion (approx) : confirmé en partie, accord « partiel », dans le fichier', [conf(p, 'pv').confirmePar, conf(p, 'pv').accord], [['pkmncards'], 'partiel']);
    verifier('le décompte sépare plein / partiel / arbitrage et les deux motifs du doute', Object.keys(plan().compte.parChamp['carte.pv']).sort(), ['aReconfirmerDesaccord', 'aReconfirmerNonCouvert', 'arbitrage', 'ecrits', 'partiel', 'plein']);
    verifier('le décompte : pv plein 1, retraite non couvert 1', [plan().compte.parChamp['carte.pv'].plein, plan().compte.parChamp['carte.retraite'].aReconfirmerNonCouvert], [1, 1]);
    verifier('le décompte : partiel et arbitrage comptés à part', [planifierProvenance({ cartes: [carte()], sets: [], lignes: [lg('carte.pv', 1, 60, { pkc: S('approx', 60) }, 'approx')], appariements: [], arbitrages: [], maintenant: T0 }).compte.parChamp['carte.pv'].partiel,
        plan({ lignes: lDes(), arbitrages: [desacc('juste', { raison: 'r', temoins: [{ source: 'tdx' }] })] }).compte.parChamp['carte.pv'].arbitrage], [1, 1]);

    // ── 4. ADDITIF : aucune valeur n’est modifiée, tout ce qui s’écrit est sous `provenance.`
    p = plan();
    verifier('tous les chemins écrits sont sous « provenance. »', Object.keys(ecr(p).champs).every(k => k.startsWith('provenance.')), true);
    const avant = carte(); const apres = appliquer(copie(avant), ecr(p).champs);
    const sansProv = o => { const c = copie(o); delete c.provenance; return c; };
    verifier('le document, hors provenance, est identique', sansProv(apres), avant);
    verifier('aucun nom de source dans un champ public (hors provenance)', JSON.stringify(sansProv(apres)).match(/pkmncards|tcgdex|pokemon-card|bulbapedia/i), null);
    const touches = setsTouches({ avant: { cartes: [avant], cartesProduits: [], sets: [] }, apres: { cartes: [apres], cartesProduits: [], sets: [] } });
    verifier('la garde de lot ne voit pas la provenance : 0 set revalidé', [touches.sets, touches.catalogue, touches.especes], [[], false, false]);

    // ── 5. IDEMPOTENT : rejouer le plan sur le résultat n’écrit rien (ni écriture ni retrait) ; le fichier des confirmations, lui, est le même
    const rejeu = planifierProvenance({ cartes: [apres], sets: [], lignes: lignesDe(), appariements: appar, arbitrages: [], maintenant: T1 });
    verifier('idempotent : rejouer sur le résultat n’écrit rien (même avec une autre date)', [rejeu.ecritures.length, rejeu.compte.champsAEcrire], [0, 0]);
    verifier('le compte annonce les champs à écrire en base : 3 marques (retraite, nomJa, rareté japonaise)', plan().compte.champsAEcrire, 3);
    verifier('les confirmations ne dépendent pas de la date', M.empreinteConfirmations(plan().confirmations) === M.empreinteConfirmations(plan({ maintenant: T1 }).confirmations), true);

    // ── 6. MONOTONE ET LIÉ À LA VALEUR : la marque porte l'empreinte `v` de la valeur qu'elle met en doute
    const existant = (champs) => carte({ provenance: { source: 'bulbapedia', le: T0, ...champs } });
    p = plan({ cartes: [existant({ retraite: reco(1) })], lignes: [lg('carte.retraite', 1, 1, { tdx: S('ok', 1) }, 'accord'), ...lignesDe().slice(2)] });
    verifier('une marque « à reconfirmer » dont une source concorde désormais est RETIRÉE (jamais laissée périmée)', [ecr(p).retraits, 'provenance.retraite' in ecr(p).champs], [['provenance.retraite'], false]);
    verifier('… et la confirmation est dans le fichier', conf(p, 'retraite').confirmePar, ['tcgdex']);
    p = plan({ cartes: [existant({ retraite: reco(1) })], lignes: lignesDe(), appariements: appar });
    verifier('marque déjà posée, même valeur, toujours à reconfirmer : inchangée', ecr(p)?.champs['provenance.retraite'] ?? 'inchangé', 'inchangé');
    p = plan({ cartes: [existant({ pv: reco(60, 'desaccord') })].map(c => ({ ...c, pv: 61 })), lignes: [lg('carte.pv', 1, 61, {}, 'sans')] });
    verifier('valeur changée (60 → 61) : la marque périmée est REMPLACÉE par celle de la nouvelle valeur', ecr(p).champs['provenance.pv'], reco(61, 'non-couvert'));
    p = plan({ cartes: [existant({ pv: reco(60, 'non-couvert') })].map(c => ({ ...c, pv: 61 })), lignes: [lg('carte.pv', 1, 61, {}, 'sans')] });
    verifier('valeur changée, même motif : seule l’empreinte `v` dit que la marque est périmée → remplacée', ecr(p).champs['provenance.pv'], reco(61, 'non-couvert'));
    p = plan({ cartes: [existant({ pv: reco(60, 'desaccord') })].map(c => ({ ...c, pv: 61 })), lignes: [lg('carte.pv', 1, 61, { pkc: S('ok', 61) }, 'accord')] });
    verifier('valeur changée et confirmée aujourd’hui : la marque périmée est retirée', ecr(p).retraits.includes('provenance.pv'), true);
    const confs = [{ collection: 'cartes', _id: 1, champ: 'pv', confirmePar: ['tcgdex'], accord: 'plein', empreinteValeur: emp(60) }, { collection: 'cartes', _id: 1, k: 'intl|Fossil|42', champ: 'rarete', confirmePar: ['tcgdex'], accord: 'plein', empreinteValeur: emp('Uncommon') }];
    verifier('confirmationValide : valeur inchangée → vrai', M.confirmationValide(confs, 'cartes', carte(), 'pv'), true);
    verifier('confirmationValide : valeur changée depuis → faux', M.confirmationValide(confs, 'cartes', carte({ pv: 61 }), 'pv'), false);
    verifier('confirmationValide : champ sans confirmation → faux', M.confirmationValide(confs, 'cartes', carte(), 'ndex'), false);
    verifier('confirmationValide : une marque « à reconfirmer » sur la même valeur l’emporte → faux', M.confirmationValide(confs, 'cartes', existant({ pv: reco(60, 'desaccord') }), 'pv'), false);
    verifier('confirmationValide d’une impression par sa clé', [M.confirmationValide(confs, 'cartes', carte(), 'rarete', 'intl|Fossil|42'), M.confirmationValide(confs, 'cartes', carte({ impressions: [{ ...carte().impressions[0], rarete: 'Rare' }, carte().impressions[1]] }), 'rarete', 'intl|Fossil|42')], [true, false]);

    // ── 6 bis. FORME ÉTRANGÈRE : une provenance déjà présente sous une AUTRE forme n’est ni écrasée ni fusionnée — sautée, comptée, listée
    // (relecture 2, M1) `provenance: null` : un `$set` de sous-chemin échouerait sur null — le document reçoit l'objet ENTIER par un `$set` de `provenance`
    p = plan({ cartes: [carte({ provenance: null })] });
    verifier('provenance: null : un seul $set de « provenance » (objet entier), jamais de sous-chemin', [Object.keys(ecr(p).champs), ecr(p).champs.provenance.source, ecr(p).champs.provenance.le, ecr(p).champs.provenance.retraite, Array.isArray(ecr(p).champs.provenance.impressions)], [['provenance'], 'bulbapedia', T0, reco(1), true]);
    const apresNull = appliquer(carte({ provenance: null }), ecr(p).champs);
    verifier('provenance: null : appliqué puis rejoué, rien à écrire', planifierProvenance({ cartes: [apresNull], sets: [], lignes: lignesDe(), appariements: appar, arbitrages: [], maintenant: T1 }).ecritures.length, 0);
    verifier('provenance absente (undefined) : sous-chemins, comme avant', Object.keys(ecr(plan()).champs).every(k => k.startsWith('provenance.')), true);
    p = plan({ cartes: [carte({ provenance: 'texte libre' })] });
    verifier('provenance non objet : le document est sauté, compté, listé', [p.ecritures.length, p.compte.formeEtrangere.documents, p.compte.formeEtrangere.liste[0]], [0, 1, { collection: 'cartes', _id: 1, chemin: 'provenance' }]);
    p = plan({ cartes: [carte({ provenance: { source: 'autre-fournisseur', pv: { valeur: 1 } } })] });
    verifier('provenance d’un autre fournisseur : le document est sauté', [p.ecritures.length, p.compte.formeEtrangere.documents], [0, 1]);
    p = plan({ cartes: [carte({ provenance: { source: 'bulbapedia', le: T0, pv: { valeur: 'x' }, retraite: reco(1) } })] });
    verifier('champ de forme étrangère : sauté, compté, listé ; les autres champs s’écrivent', ['provenance.pv' in ecr(p).champs, p.compte.formeEtrangere.champs, p.compte.formeEtrangere.liste.map(x => x.chemin)], [false, 1, ['provenance.pv']]);
    p = plan({ cartes: [carte({ provenance: { source: 'bulbapedia', le: T0, pv: { confirmePar: ['tcgdex'], accord: 'plein', empreinteValeur: emp(60) } } })] });
    verifier('l’ancienne forme (confirmation en base) est étrangère : jamais écrasée, jamais retirée', ['provenance.pv' in ecr(p).champs, (ecr(p).retraits || []).includes('provenance.pv'), p.compte.formeEtrangere.champs], [false, false, 1]);
    p = plan({ cartes: [carte({ provenance: { source: 'bulbapedia', le: T0, impressions: 'x' } })] });
    verifier('impressions non tableau : sautées, comptées (jamais lues comme vides puis écrasées)', ['provenance.impressions' in ecr(p).champs, p.compte.formeEtrangere.liste.map(x => x.chemin).includes('provenance.impressions')], [false, true]);
    p = plan({ cartes: [carte({ provenance: { source: 'bulbapedia', le: T0, impressions: [{ k: 'intl|Fossil|42', numero: 'texte' }] } })], lignes: lignesDe().filter(l => l.champ !== 'impression.rarete') });
    const impr = ecr(p).champs['provenance.impressions'];
    verifier('sous-entrée d’impression étrangère : conservée telle quelle ; les marques de l’impression s’ajoutent', [impr[0].numero, impr[0].rarete.aReconfirmer, p.compte.formeEtrangere.liste.map(x => x.chemin).includes('provenance.impressions[intl|Fossil|42].numero')], ['texte', true, true]);

    // ── 7. SETS : la source ne s'étiquette Bulbapedia que si le champ en vient PROUVÉMENT (table des champs de set, d'après le code qui les écrit)
    const set = (o = {}) => ({ _id: 'Fossil', dateSortieEn: 'October 10, 1999', dateSortieEnSource: 'bulbapedia:release', totalImprime: 62, dateSortieJa: 'x', dateSortieJaSource: 'bulbapedia:date', type: 'extension', typeSource: 'bulbapedia:infobox', ...o });
    const lS = [lg('set.dateSortieEn', 'Fossil', '1999-10-10', { tdx: S('ok', '1999-10-10') }, 'accord', { setId: 'Fossil' }), lg('set.totalImprime', 'Fossil', 62, { pkc: S('ko', 61) }, 'desaccord', { setId: 'Fossil' })];
    p = planifierProvenance({ cartes: [], sets: [set()], lignes: lS, appariements: [], arbitrages: [{ champ: 'set.totalImprime', cle: 'Fossil', verdict: 'indecidable', temoins: [] }], maintenant: T0 });
    e = ecr(p, 'sets').champs;
    verifier('set : date confirmée (fichier), total contesté, date japonaise et type non couverts (base)', [conf(p, 'dateSortieEn', 'sets').confirmePar, 'provenance.dateSortieEn' in e, e['provenance.totalImprime'].motif, e['provenance.dateSortieJa'].motif, e['provenance.type'].motif], [['tcgdex'], false, 'desaccord', 'non-couvert', 'non-couvert']);
    verifier('set : source et date au niveau du document', [e['provenance.source'], e['provenance.le']], ['bulbapedia', T0]);
    const champsSet = (o) => Object.keys(ecr(planifierProvenance({ cartes: [], sets: [set(o)], lignes: [], appariements: [], arbitrages: [], maintenant: T0 }), 'sets')?.champs || {}).filter(k => k !== 'provenance.source' && k !== 'provenance.le').sort();
    const sansOrigine = (o) => planifierProvenance({ cartes: [], sets: [set(o)], lignes: [], appariements: [], arbitrages: [], maintenant: T0 }).compte.setsSansOrigine;
    verifier('dateSortieEn : source « bulbapedia:release » → provenance posée', champsSet({}).includes('provenance.dateSortieEn'), true);
    verifier('dateSortieEn : source TCGdex → aucune provenance, comptée', [champsSet({ dateSortieEnSource: 'tcgdex:me05:idExpansion+nom' }).includes('provenance.dateSortieEn'), sansOrigine({ dateSortieEnSource: 'tcgdex:me05:idExpansion+nom' }).dateSortieEn], [false, 1]);
    verifier('dateSortieEn : source ABSENTE → aucune provenance, comptée (« inconnue n’est pas Bulbapedia »)', [champsSet({ dateSortieEnSource: undefined }).includes('provenance.dateSortieEn'), sansOrigine({ dateSortieEnSource: undefined }).dateSortieEn], [false, 1]);
    verifier('dateSortieEn : source « majorité — … » (plusieurs fournisseurs) → aucune provenance', champsSet({ dateSortieEnSource: 'majorité — 2 voix sur 3 source(s) (bulbapedia…)' }).includes('provenance.dateSortieEn'), false);
    verifier('dateSortieJa : source « bulbapedia:date » → provenance posée', champsSet({}).includes('provenance.dateSortieJa'), true);
    verifier('dateSortieJa : source officielle → aucune provenance, comptée', [champsSet({ dateSortieJaSource: 'officielle:https://www.pokemon-card.com/' }).includes('provenance.dateSortieJa'), sansOrigine({ dateSortieJaSource: 'officielle:https://www.pokemon-card.com/' }).dateSortieJa], [false, 1]);
    verifier('dateSortieJa : source ABSENTE → aucune provenance, comptée', [champsSet({ dateSortieJaSource: undefined }).includes('provenance.dateSortieJa'), sansOrigine({ dateSortieJaSource: undefined }).dateSortieJa], [false, 1]);
    verifier('type : source « bulbapedia:infobox » → provenance posée', champsSet({}).includes('provenance.type'), true);
    verifier('type : autre source → aucune provenance, comptée', [champsSet({ typeSource: 'ptcg-assets' }).includes('provenance.type'), sansOrigine({ typeSource: 'ptcg-assets' }).type], [false, 1]);
    verifier('type : source ABSENTE → aucune provenance, comptée', [champsSet({ typeSource: undefined }).includes('provenance.type'), sansOrigine({ typeSource: undefined }).type], [false, 1]);
    verifier('totalImprime : seul écrivain non nul = collecteur-texte (infobox Bulbapedia) → provenance posée sans marqueur', champsSet({}).includes('provenance.totalImprime'), true);
    verifier('totalImprime : valeur nulle → rien', champsSet({ totalImprime: null }).includes('provenance.totalImprime'), false);
    verifier('la table d’origine des champs de set nomme l’écrivain de chacun', Object.keys(M.ORIGINE_SET).sort(), ['dateSortieEn', 'dateSortieJa', 'totalImprime', 'type']);
    verifier('cartes sans le marqueur Bulbapedia ignorées', planifierProvenance({ cartes: [], sets: [], lignes: [], appariements: [], arbitrages: [], maintenant: T0 }).ecritures, []);
    // ── 7 bis. DEUX impressions à la même clé (tirage|expansion|numéro — fréquent au japonais sans numéro) : chacune a SA marque, la seconde sous « #2 »
    p = plan({ cartes: [carte({ impressions: [{ tirage: 'jp', expansion: 'X', numero: null, rarete: 'Rare' }, { tirage: 'jp', expansion: 'X', numero: null, rarete: 'Common' }] })], lignes: [], appariements: [] });
    verifier('clés en double : « jp|X| » puis « jp|X|#2 », compte des doublons à zéro (plus rien d’ignoré)', [ecr(p).champs['provenance.impressions'].map(x => x.k), p.compte.doublonsCle], [['jp|X|', 'jp|X|#2'], 0]);
    const rejeuD = planifierProvenance({ cartes: [appliquer(carte({ impressions: [{ tirage: 'jp', expansion: 'X', numero: null, rarete: 'Rare' }, { tirage: 'jp', expansion: 'X', numero: null, rarete: 'Common' }] }), ecr(p).champs)], sets: [], lignes: [], appariements: [], arbitrages: [], maintenant: T1 });
    verifier('clés en double : idempotent aussi', rejeuD.compte.champsAEcrire, 0);
    // une impression dont le champ passe de « à reconfirmer » à confirmé : sa marque est retirée, et l'entrée { k } qui reste vide disparaît
    const docMarque = carte({ impressions: [{ tirage: 'jp', expansion: 'X', numero: null, rarete: 'Rare' }], provenance: { source: 'bulbapedia', le: T0, impressions: [{ k: 'jp|X|', rarete: reco('Rare') }] } });
    p = planifierProvenance({ cartes: [docMarque], sets: [], lignes: [lg('impression.rarete', '1#0', 'Rare', { pkc: S('ok', 'Rare') }, 'accord', { tirage: 'intl' })], appariements: [], arbitrages: [], maintenant: T1 });
    verifier('marque d’impression devenue confirmée : l’entrée vide disparaît (retrait de provenance.impressions)', [ecr(p).retraits, 'provenance.impressions' in ecr(p).champs], [['provenance.impressions'], false]);

    // ── 7 ter. LE CHARGEUR LIT TOUT CE QUE LE PLANIFICATEUR LIT (une projection trop étroite lisait « absent »)
    const { PROJ_CARTES, PROJ_SETS } = require('./collecte-cartes/charger-bulba');
    verifier('projection des sets ⊇ champs lus par le planificateur', M.CHAMPS_LUS.sets.filter(k => !(k in PROJ_SETS)), []);
    verifier('projection des cartes ⊇ champs lus par le planificateur', M.CHAMPS_LUS.cartes.filter(k => !(k in PROJ_CARTES)), []);

    // ── 8. LE FICHIER DES CONFIRMATIONS : complet, daté, avec son empreinte ; le plan le référence
    const base = plan();
    const f = M.construireFichierConfirmations(base.confirmations, T0);
    verifier('fichier des confirmations : version, source, date, nombre, empreinte, entrées', [f.version, f.source, f.genereLe, f.nombre, f.entrees.length, /^[0-9a-f]{64}$/.test(f.empreinte)], [1, 'bulbapedia', T0.toISOString(), 6, 6, true]);
    verifier('fichier des confirmations : intact → aucune erreur', M.verifierFichierConfirmations(JSON.parse(JSON.stringify(f))), []);
    verifier('fichier des confirmations : une entrée retirée → refus (nombre et empreinte)', M.verifierFichierConfirmations({ ...JSON.parse(JSON.stringify(f)), entrees: f.entrees.slice(1) }).length >= 1, true);
    verifier('fichier des confirmations : une entrée modifiée à effectif égal → refus (empreinte)', M.verifierFichierConfirmations({ ...JSON.parse(JSON.stringify(f)), entrees: f.entrees.map((x, i) => i ? x : { ...x, confirmePar: ['autre'] }) }).length, 1);
    verifier('fichier des confirmations : le nombre annoncé doit être celui des entrées', M.verifierFichierConfirmations({ ...JSON.parse(JSON.stringify(f)), nombre: 7 }).length, 1);
    verifier('fichier des confirmations : toute confirmation porte ses preuves', f.entrees.every(x => Array.isArray(x.confirmePar) && x.confirmePar.length && ['plein', 'partiel', 'arbitrage'].includes(x.accord) && typeof x.empreinteValeur === 'string'), true);

    // ── 9. LE PLAN SIGNÉ : l'écriture exige le fichier de plan de l'essai à blanc et son empreinte sha256 ; elle recalcule et refuse toute différence (écritures ET confirmations)
    const { analyserArguments, verifierPlan, verifierRelecture, empreintePlan, verifierPlanFichier } = M;
    const SHA = 'a'.repeat(64);
    verifier('arguments : sans option = simulation', analyserArguments([]), { erreurs: [], ecrire: false, attendu: null, viaEcriture: false, plan: null, empreinte: null, sources: null, variants: null, sortie: null });
    verifier('arguments : --ecrire sans --attendu refusé', analyserArguments(['--ecrire', '--plan=p.json', `--empreinte=${SHA}`]).erreurs.length, 1);
    verifier('arguments : --ecrire sans --plan ni --empreinte refusé', analyserArguments(['--ecrire', '--attendu=3']).erreurs.length, 2);
    verifier('arguments : --empreinte qui n’est pas un sha256 refusée', analyserArguments(['--ecrire', '--attendu=3', '--plan=p.json', '--empreinte=abc']).erreurs.length, 1);
    verifier('arguments : --plan / --empreinte sans --ecrire refusés', analyserArguments([`--plan=p.json`, `--empreinte=${SHA}`]).erreurs.length, 2);
    verifier('arguments : --sortie (le plan écrit à blanc) refusée avec --ecrire', analyserArguments(['--ecrire', '--attendu=3', '--plan=p.json', `--empreinte=${SHA}`, '--sortie=x.json']).erreurs.length, 1);
    verifier('arguments : --attendu sans --ecrire refusé', analyserArguments(['--attendu=3']).erreurs.length, 1);
    verifier('arguments : --attendu non entier refusé', analyserArguments(['--ecrire', '--attendu=abc', '--plan=p.json', `--empreinte=${SHA}`]).erreurs.length, 1);
    verifier('arguments : inconnu refusé', analyserArguments(['--tout-effacer']).erreurs.length, 1);
    verifier('arguments : écriture complète acceptée', analyserArguments(['--ecrire', '--attendu=12', '--plan=p.json', `--empreinte=${SHA}`]), { erreurs: [], ecrire: true, attendu: 12, viaEcriture: false, plan: 'p.json', empreinte: SHA, sources: null, variants: null, sortie: null });
    verifier('plan différent de l’attendu : refus avant toute écriture', [verifierPlan(9, 9), typeof verifierPlan(8, 9)], [null, 'string']);
    verifier('relecture : écrits ≠ attendus, restes après écriture, ou modifiedCount ≠ documents envoyés, sont des discordances',
        [verifierRelecture({ ecrits: 9, attendu: 9, restants: 0, modifies: 4, documents: 4 }), typeof verifierRelecture({ ecrits: 8, attendu: 9, restants: 0, modifies: 4, documents: 4 }), typeof verifierRelecture({ ecrits: 9, attendu: 9, restants: 2, modifies: 4, documents: 4 }), typeof verifierRelecture({ ecrits: 9, attendu: 9, restants: 0, modifies: 3, documents: 4 })], [null, 'string', 'string', 'string']);
    const pA = plan(); const pB = plan({ maintenant: T1 });
    verifier('empreinte du plan : indépendante de la date, stable', [empreintePlan(pA.ecritures) === empreintePlan(pB.ecritures), /^[0-9a-f]{64}$/.test(empreintePlan(pA.ecritures))], [true, true]);
    verifier('empreinte du plan : change si un seul champ change', empreintePlan(pA.ecritures) === empreintePlan(plan({ lignes: lignesDe().slice(1) }).ecritures), false);
    verifier('empreinte des confirmations : change si une confirmation change', M.empreinteConfirmations(pA.confirmations) === M.empreinteConfirmations(plan({ lignes: lignesDe().slice(1) }).confirmations), false);
    const empC = M.empreinteConfirmations(pA.confirmations);
    const fichier = { options: { sources: null, variants: null }, attendu: 3, empreinteEcritures: empreintePlan(pA.ecritures), empreinteConfirmations: empC, confirmations: { chemin: 'c.json', sha256: 'd'.repeat(64) }, entrees: { a: 'x', b: 'y' } };
    const recalcul = { attendu: 3, empreinteEcritures: empreintePlan(pA.ecritures), empreinteConfirmations: empC, entrees: { a: 'x', b: 'y' } };
    const confFichier = { sha256: 'd'.repeat(64), empreinteInterne: empC };
    const v = (o = {}) => verifierPlanFichier({ plan: fichier, shaFichier: SHA, empreinteDonnee: SHA, recalcul, confirmationsFichier: confFichier, options: { sources: null, variants: null }, ...o });
    verifier('plan signé identique au recalcul : aucune erreur', v(), []);
    verifier('plan : empreinte donnée ≠ sha256 du fichier → refus', v({ empreinteDonnee: 'b'.repeat(64) }).length, 1);
    verifier('plan : le recalcul écrit un autre nombre de champs → refus', v({ recalcul: { ...recalcul, attendu: 10 } }).length >= 1, true);
    verifier('plan : même nombre mais contenu différent (empreinte des écritures) → refus', v({ recalcul: { ...recalcul, empreinteEcritures: 'c'.repeat(64) } }).length, 1);
    verifier('plan : les confirmations recalculées diffèrent de celles du plan → refus', v({ recalcul: { ...recalcul, empreinteConfirmations: 'c'.repeat(64) } }).length >= 1, true);
    verifier('plan : le fichier des confirmations a changé (sha256 des octets) → refus', v({ confirmationsFichier: { ...confFichier, sha256: 'e'.repeat(64) } }).length, 1);
    verifier('plan : le fichier des confirmations porte une autre empreinte interne → refus', v({ confirmationsFichier: { ...confFichier, empreinteInterne: 'f'.repeat(64) } }).length, 1);
    verifier('plan : un fichier d’entrée (index, variantes, alias) a changé → refus', v({ recalcul: { ...recalcul, entrees: { a: 'x', b: 'z' } } }).length, 1);
    verifier('plan : --sources autre que celui du plan → refus', v({ options: { sources: 'D:/autre', variants: null } }).length, 1);
    verifier('plan : --variants autre que celui du plan → refus', v({ options: { sources: null, variants: 'D:/autre.json' } }).length, 1);
    verifier('plan : --sources identique à celui du plan → accepté', verifierPlanFichier({ plan: { ...fichier, options: { sources: 'D:/s', variants: null } }, shaFichier: SHA, empreinteDonnee: SHA, recalcul, confirmationsFichier: confFichier, options: { sources: 'D:/s', variants: null } }), []);
    return { ok, ko };
}
module.exports = { suite };

if (require.main === module) {
    const { ok, ko } = suite(require('./collecte-cartes/provenance-bulba'));
    console.log(`\n${ok} passés, ${ko} en échec`);
    if (ko) process.exit(1);
}
