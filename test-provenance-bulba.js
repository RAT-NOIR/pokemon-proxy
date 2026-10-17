// node test-provenance-bulba.js — la provenance PAR CHAMP des données d'origine Bulbapedia, et la marque « à reconfirmer » (décision du testeur, 2026-10-17 :
// « pour les cas sans aucun remplaçant, garde la valeur, marque-la à reconfirmer, et ne la sers pas comme seule preuve d'une identification »).
// Fonctions pures, faux objets. `suite(module)` est rejouée contre des mutants (test-mutants-bulba.js).
// Correction 1 (2026-10-18, relecture 1) : forme étrangère, empreinte de la valeur certifiée, accord plein/partiel/arbitrage et motif du doute, origine des champs de set,
// source et date remontées au document, plan signé (empreinte sha256) pour l'écriture, modifiedCount comparé.
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

    // ── 1. CONFIRMÉ : au moins une source indépendante concorde → confirmePar, accord, empreinte de la valeur ; PAS de marque. `source` et `le` vivent au DOCUMENT.
    let p = plan(); let e = ecr(p).champs;
    verifier('pv confirmé par deux sources : accord plein, empreinte de la valeur certifiée', e['provenance.pv'], { confirmePar: ['pkmncards', 'tcgdex'], accord: 'plein', empreinteValeur: emp(60) });
    verifier('source et date au niveau du document, pas répétées par champ', [e['provenance.source'], e['provenance.le'], Object.values(e).filter(v => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)).some(v => 'source' in v || 'le' in v)], ['bulbapedia', T0, false]);
    verifier('ndex confirmé par une source', e['provenance.ndex'].confirmePar, ['tcgdex']);
    // ── 2. SANS AUCUN REMPLAÇANT : la valeur reste, la marque est posée par champ, avec son MOTIF
    verifier('retraite sans source : « à reconfirmer », motif « non-couvert » (aucune source n’a interrogé ce champ)', e['provenance.retraite'], { confirmePar: [], aReconfirmer: true, motif: 'non-couvert', empreinteValeur: emp(1) });
    // ── 3. LE NOM ET LE NUMÉRO : confirmés par l'appariement (set, numéro) dont le nom concorde
    verifier('nomEn confirmé par les sources dont l’appariement (set, numéro) a un nom concordant', e['provenance.nomEn'].confirmePar, ['pkmncards', 'tcgdex']);
    verifier('nomJa sans appariement japonais : à reconfirmer, non couvert', [e['provenance.nomJa'].aReconfirmer, e['provenance.nomJa'].confirmePar, e['provenance.nomJa'].motif], [true, [], 'non-couvert']);
    const imp = e['provenance.impressions'];
    verifier('impression intl : clé tirage|expansion|numéro, numéro confirmé', [imp[0].k, imp[0].numero.confirmePar], ['intl|Fossil|42', ['pkmncards', 'tcgdex']]);
    verifier('impression intl : total et rareté confirmés', [imp[0].total.confirmePar, imp[0].rarete.confirmePar], [['pkmncards'], ['pkmncards', 'tcgdex']]);
    verifier('impression japonaise sans source : rareté à reconfirmer, numéro absent donc sans entrée, total non numérique ignoré', [imp[1].k, imp[1].rarete.aReconfirmer, 'numero' in imp[1], 'total' in imp[1]], ['jp|Mystery of the Fossils|', true, false, false]);
    p = plan({ appariements: [{ carteId: 1, idx: 0, tirage: 'intl', src: 'pkc', nomOk: false }] });
    verifier('nom divergent à l’appariement : ni le nom ni le numéro ne sont confirmés, motif « desaccord »', [ecr(p).champs['provenance.nomEn'].aReconfirmer, ecr(p).champs['provenance.nomEn'].motif, ecr(p).champs['provenance.impressions'][0].numero.motif], [true, 'desaccord', 'desaccord']);
    p = plan({ cartes: [carte({ nomEn: 'Seadra' })], appariements: [{ carteId: 1, idx: 1, tirage: 'jp', src: 'jp', nomOk: true }] });
    verifier('nomJa confirmé par pokemon-card.com (appariement japonais, nom concordant)', ecr(p).champs['provenance.nomJa'].confirmePar, ['pokemon-card.com']);

    // ── 4. DÉSACCORDS : l'arbitrage décide ; une valeur contestée n’est JAMAIS « confirmée » par défaut. Le décompte SÉPARE plein, partiel et arbitrage.
    const desacc = (verdict, extra = {}) => ({ champ: 'carte.pv', cle: 1, verdict, temoins: [], ...extra });
    const lDes = () => [lg('carte.pv', 1, 60, { pkc: S('ko', 50) }, 'desaccord')];
    p = plan({ lignes: lDes(), arbitrages: [desacc('indecidable')] });
    verifier('désaccord indécidable : à reconfirmer, motif « desaccord », la source qui contredit', [ecr(p).champs['provenance.pv'].aReconfirmer, ecr(p).champs['provenance.pv'].motif, ecr(p).champs['provenance.pv'].contredit], [true, 'desaccord', ['pkmncards']]);
    p = plan({ lignes: lDes(), arbitrages: [desacc('fausse', { correction: 50 })] });
    verifier('désaccord arbitré « fausse » : à reconfirmer (la valeur reste, la correction attend son lot)', [ecr(p).champs['provenance.pv'].aReconfirmer, ecr(p).champs['provenance.pv'].motif], [true, 'desaccord']);
    p = plan({ lignes: lDes(), arbitrages: [desacc('juste', { raison: 'convention de nom', temoins: [{ source: 'tdx', valeur: 'x' }, { source: 'convention-calibree', valeur: {} }] })] });
    verifier('désaccord arbitré « juste » : confirmé par les sources témoins (pas par les tables), accord « arbitrage »', [ecr(p).champs['provenance.pv'].confirmePar, ecr(p).champs['provenance.pv'].aReconfirmer ?? false, ecr(p).champs['provenance.pv'].via, ecr(p).champs['provenance.pv'].accord], [['tcgdex'], false, 'convention de nom', 'arbitrage']);
    p = plan({ lignes: lDes(), arbitrages: [] });
    verifier('désaccord SANS arbitrage : jamais confirmé (la garde s’écrit par ce qu’elle autorise)', ecr(p).champs['provenance.pv'].aReconfirmer, true);
    p = plan({ lignes: [lg('carte.pv', 1, 60, { pkc: S('approx', 60) }, 'approx')] });
    verifier('inclusion (approx) : confirmé en partie, accord « partiel »', [ecr(p).champs['provenance.pv'].confirmePar, ecr(p).champs['provenance.pv'].accord], [['pkmncards'], 'partiel']);
    verifier('le décompte sépare plein / partiel / arbitrage et les deux motifs du doute', Object.keys(plan().compte.parChamp['carte.pv']).sort(), ['aReconfirmerDesaccord', 'aReconfirmerNonCouvert', 'arbitrage', 'ecrits', 'partiel', 'plein']);
    verifier('le décompte : pv plein 1, retraite non couvert 1', [plan().compte.parChamp['carte.pv'].plein, plan().compte.parChamp['carte.retraite'].aReconfirmerNonCouvert], [1, 1]);
    verifier('le décompte : partiel et arbitrage comptés à part', [planifierProvenance({ cartes: [carte()], sets: [], lignes: [lg('carte.pv', 1, 60, { pkc: S('approx', 60) }, 'approx')], appariements: [], arbitrages: [], maintenant: T0 }).compte.parChamp['carte.pv'].partiel,
        plan({ lignes: lDes(), arbitrages: [desacc('juste', { raison: 'r', temoins: [{ source: 'tdx' }] })] }).compte.parChamp['carte.pv'].arbitrage], [1, 1]);

    // ── 5. ADDITIF : aucune valeur n’est modifiée, tout ce qui s’écrit est sous `provenance.`
    p = plan();
    verifier('tous les chemins écrits sont sous « provenance. »', Object.keys(ecr(p).champs).every(k => k.startsWith('provenance.')), true);
    const avant = carte(); const apres = appliquer(copie(avant), ecr(p).champs);
    const sansProv = o => { const c = copie(o); delete c.provenance; return c; };
    verifier('le document, hors provenance, est identique', sansProv(apres), avant);
    verifier('aucun nom de source dans un champ public (hors provenance)', JSON.stringify(sansProv(apres)).match(/pkmncards|tcgdex|pokemon-card|bulbapedia/i), null);
    const touches = setsTouches({ avant: { cartes: [avant], cartesProduits: [], sets: [] }, apres: { cartes: [apres], cartesProduits: [], sets: [] } });
    verifier('la garde de lot ne voit pas la provenance : 0 set revalidé', [touches.sets, touches.catalogue, touches.especes], [[], false, false]);

    // ── 6. IDEMPOTENT : rejouer le plan sur le résultat n’écrit rien
    const rejeu = planifierProvenance({ cartes: [apres], sets: [], lignes: lignesDe(), appariements: appar, arbitrages: [], maintenant: T1 });
    verifier('idempotent : rejouer sur le résultat n’écrit rien (même avec une autre date)', [rejeu.ecritures.length, rejeu.compte.champsAEcrire], [0, 0]);
    verifier('le compte annonce les champs à écrire (attendu) : source et date du document ne comptent pas', plan().compte.champsAEcrire, 9);
    // aucune entrée d'impression vide : { k } seul ne s'écrit jamais
    p = plan({ cartes: [carte({ impressions: [{ tirage: 'intl', expansion: 'X', numero: null, total: null, rarete: null }] })], lignes: [], appariements: [] });
    verifier('une impression sans aucun champ à certifier n’écrit aucune entrée { k }', 'provenance.impressions' in ecr(p).champs, false);

    // ── 7. MONOTONE ET LIÉE À LA VALEUR : on améliore, on ne dégrade pas une confirmation… tant que la valeur certifiée est celle d’aujourd’hui
    const entree = (v, o = {}) => ({ confirmePar: ['tcgdex'], accord: 'plein', empreinteValeur: emp(v), ...o });
    const reco = v => ({ confirmePar: [], aReconfirmer: true, motif: 'non-couvert', empreinteValeur: emp(v) });
    const existant = (champs) => carte({ provenance: { source: 'bulbapedia', le: T0, ...champs } });
    p = plan({ cartes: [existant({ retraite: reco(1), pv: entree(60) })], lignes: [lg('carte.retraite', 1, 1, { tdx: S('ok', 1) }, 'accord'), lg('carte.pv', 1, 60, { pkc: S('ok', 60) }, 'accord')], maintenant: T1 });
    verifier('à reconfirmer + une source qui confirme désormais → confirmé', ecr(p).champs['provenance.retraite'], { confirmePar: ['tcgdex'], accord: 'plein', empreinteValeur: emp(1) });
    verifier('confirmé par tcgdex + pkmncards confirme aussi → union', ecr(p).champs['provenance.pv'].confirmePar, ['pkmncards', 'tcgdex']);
    p = plan({ cartes: [existant({ pv: entree(60) })], lignes: [lg('carte.pv', 1, 60, {}, 'sans')] });
    verifier('confirmé hier, aucune source aujourd’hui, MÊME valeur : la confirmation reste', (ecr(p)?.champs['provenance.pv']) ?? 'inchangé', 'inchangé');
    p = plan({ cartes: [existant({ pv: entree(60, { accord: 'partiel' }) })], lignes: [lg('carte.pv', 1, 60, { pkc: S('ok', 60), tdx: S('ok', 60) }, 'accord')] });
    verifier('partiel hier, plein aujourd’hui : le meilleur accord l’emporte', [ecr(p).champs['provenance.pv'].accord, ecr(p).champs['provenance.pv'].confirmePar], ['plein', ['pkmncards', 'tcgdex']]);
    // la valeur a changé depuis la confirmation (lot 5, correction…) : l'ancienne confirmation ne vaut plus, elle est REMPLACÉE par la décision d'aujourd'hui
    p = plan({ cartes: [existant({ pv: entree(60) })].map(c => ({ ...c, pv: 61 })), lignes: [lg('carte.pv', 1, 61, {}, 'sans')] });
    verifier('valeur changée (60 → 61) : la confirmation périmée est remplacée, à reconfirmer sur la NOUVELLE valeur', ecr(p).champs['provenance.pv'], reco(61));
    const docConfirme = existant({ pv: entree(60), retraite: reco(1) });
    verifier('confirmationValide : valeur inchangée → vrai', M.confirmationValide(docConfirme, 'pv'), true);
    verifier('confirmationValide : valeur changée depuis → faux', M.confirmationValide({ ...docConfirme, pv: 61 }, 'pv'), false);
    verifier('confirmationValide : « à reconfirmer » n’est jamais une confirmation', M.confirmationValide(docConfirme, 'retraite'), false);
    verifier('confirmationValide : champ sans provenance → faux', M.confirmationValide(docConfirme, 'ndex'), false);
    const docImp = carte({ provenance: { source: 'bulbapedia', le: T0, impressions: [{ k: 'intl|Fossil|42', rarete: entree('Uncommon') }] } });
    verifier('confirmationValide d’une impression par sa clé, valeur inchangée', M.confirmationValide(docImp, 'rarete', 'intl|Fossil|42'), true);
    verifier('confirmationValide d’une impression : rareté changée → faux', M.confirmationValide({ ...docImp, impressions: [{ ...docImp.impressions[0], rarete: 'Rare' }, docImp.impressions[1]] }, 'rarete', 'intl|Fossil|42'), false);

    // ── 7 bis. FORME ÉTRANGÈRE : une provenance déjà présente sous une AUTRE forme n’est ni écrasée ni fusionnée — sautée, comptée, listée
    p = plan({ cartes: [carte({ provenance: 'texte libre' })] });
    verifier('provenance non objet : le document est sauté, compté, listé', [p.ecritures.length, p.compte.formeEtrangere.documents, p.compte.formeEtrangere.liste[0]], [0, 1, { collection: 'cartes', _id: 1, chemin: 'provenance' }]);
    p = plan({ cartes: [carte({ provenance: { source: 'autre-fournisseur', pv: { valeur: 1 } } })] });
    verifier('provenance d’un autre fournisseur : le document est sauté', [p.ecritures.length, p.compte.formeEtrangere.documents], [0, 1]);
    p = plan({ cartes: [carte({ provenance: { source: 'bulbapedia', le: T0, pv: { valeur: 'x' }, retraite: reco(1) } })] });
    verifier('champ de forme étrangère : sauté, compté, listé ; les autres champs s’écrivent', ['provenance.pv' in ecr(p).champs, 'provenance.retraite' in ecr(p).champs, p.compte.formeEtrangere.champs, p.compte.formeEtrangere.liste.map(x => x.chemin)], [false, false, 1, ['provenance.pv']]);
    verifier('champ de forme étrangère : l’objet étranger n’est jamais écrasé', Object.keys(ecr(p).champs).includes('provenance.pv'), false);
    p = plan({ cartes: [carte({ provenance: { source: 'bulbapedia', le: T0, impressions: 'x' } })] });
    verifier('impressions non tableau : sautées, comptées (jamais lues comme vides puis écrasées)', ['provenance.impressions' in ecr(p).champs, p.compte.formeEtrangere.liste.map(x => x.chemin).includes('provenance.impressions')], [false, true]);
    p = plan({ cartes: [carte({ provenance: { source: 'bulbapedia', le: T0, impressions: [{ k: 'intl|Fossil|42', numero: 'texte', total: entree('62') }] } })] });
    const impr = ecr(p).champs['provenance.impressions'];
    verifier('sous-entrée d’impression étrangère : conservée telle quelle, jamais fusionnée ; les autres champs de l’impression s’ajoutent', [impr[0].numero, impr[0].rarete.confirmePar, p.compte.formeEtrangere.liste.map(x => x.chemin).includes('provenance.impressions[intl|Fossil|42].numero')], ['texte', ['pkmncards', 'tcgdex'], true]);

    // ── 8. SETS : la source ne s'étiquette Bulbapedia que si le champ en vient PROUVÉMENT (table des champs de set, d'après le code qui les écrit)
    const set = (o = {}) => ({ _id: 'Fossil', dateSortieEn: 'October 10, 1999', dateSortieEnSource: 'bulbapedia:release', totalImprime: 62, dateSortieJa: 'x', dateSortieJaSource: 'bulbapedia:date', type: 'extension', typeSource: 'bulbapedia:infobox', ...o });
    const lS = [lg('set.dateSortieEn', 'Fossil', '1999-10-10', { tdx: S('ok', '1999-10-10') }, 'accord', { setId: 'Fossil' }), lg('set.totalImprime', 'Fossil', 62, { pkc: S('ko', 61) }, 'desaccord', { setId: 'Fossil' })];
    p = planifierProvenance({ cartes: [], sets: [set()], lignes: lS, appariements: [], arbitrages: [{ champ: 'set.totalImprime', cle: 'Fossil', verdict: 'indecidable', temoins: [] }], maintenant: T0 });
    e = ecr(p, 'sets').champs;
    verifier('set : date confirmée, total contesté à reconfirmer, date japonaise et type sans remplaçant (non couverts)', [e['provenance.dateSortieEn'].confirmePar, e['provenance.totalImprime'].motif, e['provenance.dateSortieJa'].motif, e['provenance.type'].motif], [['tcgdex'], 'desaccord', 'non-couvert', 'non-couvert']);
    verifier('set : source et date au niveau du document', [e['provenance.source'], e['provenance.le']], ['bulbapedia', T0]);
    const champsSet = (o) => Object.keys(ecr(planifierProvenance({ cartes: [], sets: [set(o)], lignes: [], appariements: [], arbitrages: [], maintenant: T0 }), 'sets')?.champs || {}).filter(k => k !== 'provenance.source' && k !== 'provenance.le').sort();
    const sansOrigine = (o) => planifierProvenance({ cartes: [], sets: [set(o)], lignes: [], appariements: [], arbitrages: [], maintenant: T0 }).compte.setsSansOrigine;
    // un test par champ de set
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
    // ── 8 bis. DEUX impressions à la même clé (tirage|expansion|numéro — fréquent au japonais sans numéro) : chacune a SA provenance, la seconde sous « #2 »
    p = plan({ cartes: [carte({ impressions: [{ tirage: 'jp', expansion: 'X', numero: null, rarete: 'Rare' }, { tirage: 'jp', expansion: 'X', numero: null, rarete: 'Common' }] })], lignes: [], appariements: [] });
    verifier('clés en double : « jp|X| » puis « jp|X|#2 », compte des doublons à zéro (plus rien d’ignoré)', [ecr(p).champs['provenance.impressions'].map(x => x.k), p.compte.doublonsCle], [['jp|X|', 'jp|X|#2'], 0]);
    const rejeuD = planifierProvenance({ cartes: [appliquer(carte({ impressions: [{ tirage: 'jp', expansion: 'X', numero: null, rarete: 'Rare' }, { tirage: 'jp', expansion: 'X', numero: null, rarete: 'Common' }] }), ecr(p).champs)], sets: [], lignes: [], appariements: [], arbitrages: [], maintenant: T1 });
    verifier('clés en double : idempotent aussi', rejeuD.compte.champsAEcrire, 0);

    // ── 8 ter. LE CHARGEUR LIT TOUT CE QUE LE PLANIFICATEUR LIT (une projection trop étroite lisait « absent » : les sources de date n'étaient pas chargées)
    const { PROJ_CARTES, PROJ_SETS } = require('./collecte-cartes/charger-bulba');
    verifier('projection des sets ⊇ champs lus par le planificateur', M.CHAMPS_LUS.sets.filter(k => !(k in PROJ_SETS)), []);
    verifier('projection des cartes ⊇ champs lus par le planificateur', M.CHAMPS_LUS.cartes.filter(k => !(k in PROJ_CARTES)), []);

    // ── 9. LE PLAN SIGNÉ : l'écriture exige le fichier de plan de l'essai à blanc et son empreinte sha256 ; elle recalcule et refuse toute différence
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
    const fichier = { options: { sources: null, variants: null }, attendu: 9, empreinteEcritures: empreintePlan(pA.ecritures), entrees: { a: 'x', b: 'y' } };
    const recalcul = { attendu: 9, empreinteEcritures: empreintePlan(pA.ecritures), entrees: { a: 'x', b: 'y' } };
    const v = (o = {}) => verifierPlanFichier({ plan: fichier, shaFichier: SHA, empreinteDonnee: SHA, recalcul, options: { sources: null, variants: null }, ...o });
    verifier('plan signé identique au recalcul : aucune erreur', v(), []);
    verifier('plan : empreinte donnée ≠ sha256 du fichier → refus', v({ empreinteDonnee: 'b'.repeat(64) }).length, 1);
    verifier('plan : le recalcul écrit un autre nombre de champs → refus', v({ recalcul: { ...recalcul, attendu: 10 } }).length >= 1, true);
    verifier('plan : même nombre mais contenu différent (empreinte des écritures) → refus', v({ recalcul: { ...recalcul, empreinteEcritures: 'c'.repeat(64) } }).length, 1);
    verifier('plan : un fichier d’entrée (index, variantes, alias) a changé → refus', v({ recalcul: { ...recalcul, entrees: { a: 'x', b: 'z' } } }).length, 1);
    verifier('plan : --sources autre que celui du plan → refus', v({ options: { sources: 'D:/autre', variants: null } }).length, 1);
    verifier('plan : --variants autre que celui du plan → refus', v({ options: { sources: null, variants: 'D:/autre.json' } }).length, 1);
    verifier('plan : --sources identique à celui du plan → accepté', verifierPlanFichier({ plan: { ...fichier, options: { sources: 'D:/s', variants: null } }, shaFichier: SHA, empreinteDonnee: SHA, recalcul, options: { sources: 'D:/s', variants: null } }), []);
    return { ok, ko };
}
module.exports = { suite };

if (require.main === module) {
    const { ok, ko } = suite(require('./collecte-cartes/provenance-bulba'));
    console.log(`\n${ok} passés, ${ko} en échec`);
    if (ko) process.exit(1);
}
